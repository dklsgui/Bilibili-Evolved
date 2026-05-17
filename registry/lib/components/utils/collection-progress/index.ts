import { defineComponentMetadata } from '@/components/define'
import { addControlBarButton } from '@/components/video/video-control-bar'
import { playerUrls } from '@/core/utils/urls'
import { urlChange } from '@/core/observer'
import { getJsonWithCredentials } from '@/core/ajax'
import { logError } from '@/core/utils/log'
import { Toast } from '@/core/toast'
import { getComponentSettings } from '@/core/settings'
import desc from './index.md'

// 合集进度跟踪组件
// - 识别当前视频是否为分P或UGC合集
// - 在控制栏提供“跟踪合集”按钮以开启记录
// - 进入合集时提示是否跳转到上次位置或保持当前分集
// - 通过播放器事件定期写入位置并在结束时更新到下一分集

type CollectionId = string

interface RecordLast {
  aid?: string
  bvid?: string
  cid?: number
  videoTitle?: string
  page?: number
  positionSec?: number
  durationSec?: number
  updatedAt?: string
  playFinished?: boolean
}
interface RecordItem {
  id: CollectionId
  title?: string
  last?: RecordLast
  next?: { aid?: string; bvid?: string; cid?: number; page?: number }
  meta?: { up_uid?: number; up_name?: string }
  collectionType?: CollectionType
  lastWatchTime?: number
}
interface StoreShape {
  version: number
  collections: RecordItem[]
}
interface ComponentOptions {
  [key: string]: unknown
  maxTracked: number
  autoJump: boolean
}

enum CollectionType {
  Season = 'season',
  Multi = 'multi',
  None = 'none',
}

// 本地存储键名
const storeKey = 'be:collection-progress:v1'

// 工具方法：当前时间戳（ISO）与秒数规范化
const nowIso = () => new Date().toISOString()
const sec = (n: number) => Math.max(0, Math.floor(n || 0))
const getPages = (data: any) => (Array.isArray(data?.pages) ? data.pages : [])
const getCurrentPageItem = (data: any, cid = unsafeWindow.cid) =>
  getPages(data).find((p: any) => p.cid === Number(cid))
const getCurrentPage = (data: any, cid = unsafeWindow.cid) => getCurrentPageItem(data, cid)?.page
const getSeasonEpisodes = (data: any) => {
  const seasonId = lodash.get(data, 'season_id')
  const sections = lodash.get(data, 'ugc_season.sections', [])
  if (!Array.isArray(sections)) {
    return []
  }
  return sections.find((section: any) => section?.season_id === seasonId)?.episodes ?? []
}

// 读取本地存储中的合集记录
const readStore = (): StoreShape => {
  try {
    const raw = localStorage.getItem(storeKey)
    if (!raw) {
      return { version: 1, collections: [] }
    }
    const parsed = JSON.parse(raw)
    if (!parsed.version) {
      parsed.version = 1
    }
    if (!parsed.collections) {
      parsed.collections = []
    }
    return parsed
  } catch {
    return { version: 1, collections: [] }
  }
}

// 写入本地存储
const writeStore = (data: StoreShape) => {
  localStorage.setItem(storeKey, JSON.stringify(data))
}

// 插入或更新合集记录
const upsertCollection = (item: RecordItem) => {
  const store = readStore()
  const idx = store.collections.findIndex(it => it.id === item.id)
  if (idx >= 0) {
    const oldLast = { ...store.collections[idx].last, ...item.last }
    store.collections[idx] = { ...store.collections[idx], ...item, last: oldLast }
  } else {
    store.collections.push(item)
  }
  writeStore(store)
}

// 获取指定合集记录
const getCollection = (id: CollectionId) => readStore().collections.find(it => it.id === id)

// 删除指定合集记录
const removeCollection = (id: CollectionId) => {
  const store = readStore()
  store.collections = store.collections.filter(it => it.id !== id)
  writeStore(store)
}

// 拉取稿件信息，用于判断分P与UGC合集
const fetchView = async (aid?: string, bvid?: string, cid?: string | number) => {
  let url = aid
    ? `https://api.bilibili.com/x/web-interface/view?aid=${aid}`
    : `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`
  if (cid) {
    url += `&cid=${Number(cid)}`
  }
  const json = await getJsonWithCredentials(url)
  if (json.code !== 0) {
    throw new Error(json.message)
  }
  return json.data
}

// 从视频数据中提取合集类型（分P、UGC season、无合集）
const getCollectionType = (data: any): CollectionType => {
  const season = lodash.get(data, 'season_id')
  if (season) {
    return CollectionType.Season
  }
  if (getPages(data).length > 1) {
    return CollectionType.Multi
  }
  return CollectionType.None
}

// 生成合集ID：优先UGC season，其次分P（aid）
const resolveCollectionId = (data: any): RecordItem['id'] | null => {
  const collectionType = getCollectionType(data)
  if (collectionType === CollectionType.Season) {
    return `season:${data.season_id}`
  }
  if (collectionType === CollectionType.Multi) {
    return `multi:${data.aid}`
  }
  return null
}

// 从播放器读取当前秒数
const secondsFromPlayer = async (): Promise<number> => {
  const { playerAgent } = await import('@/components/video/player-agent')
  const video = await playerAgent.query.video.element()
  if (video instanceof HTMLVideoElement) {
    return video.currentTime || 0
  }
  return 0
}

// 将播放器移动到不小于指定秒数的位置
const seekPlayer = async (seconds: number) => {
  const { playerAgent } = await import('@/components/video/player-agent')
  const video = await playerAgent.query.video.element()
  if (video instanceof HTMLVideoElement) {
    try {
      video.currentTime = Math.max(0, seconds)
    } catch (e) {
      logError(e)
    }
  }
}

// 跳转到指定稿件/分P
const navigateTo = (bvid: string, page?: number) => {
  const base = `https://www.bilibili.com/video/${bvid}`
  const url = page ? `${base}?p=${page}` : base
  window.location.href = url
}

// 播放器进度跟踪：timeupdate节流写入，ended更新到下一分P
const timeupdateTracker = (() => {
  let installed = false
  let lastWrite = 0
  const writeInterval = 10
  let elRef: HTMLVideoElement | null = null
  let timeupdateHandlerRef: (this: HTMLVideoElement, ev: Event) => any
  let endedHandlerRef: (this: HTMLVideoElement, ev: Event) => any
  const handler = async (collectionId: CollectionId) => {
    const now = Date.now()
    if (now - lastWrite < writeInterval * 1000) {
      return
    }
    lastWrite = now
    const positionSec = await secondsFromPlayer()
    upsertCollection({
      id: collectionId,
      last: {
        positionSec: sec(positionSec),
      },
    })
  }
  return {
    async attach(collectionId: CollectionId) {
      if (installed) {
        return
      }
      const { playerAgent } = await import('@/components/video/player-agent')
      const el = await playerAgent.query.video.element()
      if (!(el instanceof HTMLVideoElement)) {
        return
      }
      installed = true
      lastWrite = 0
      elRef = el
      timeupdateHandlerRef = () => handler(collectionId)
      endedHandlerRef = () => {
        upsertCollection({
          id: collectionId,
          last: {
            playFinished: true,
          },
        })
      }
      el.addEventListener('timeupdate', timeupdateHandlerRef)
      el.addEventListener('ended', endedHandlerRef)
      await handler(collectionId)
    },
    detach() {
      if (!installed || !elRef) {
        return
      }
      elRef.removeEventListener('timeupdate', timeupdateHandlerRef)
      elRef.removeEventListener('ended', endedHandlerRef)
      installed = false
      lastWrite = 0
      elRef = null
      timeupdateHandlerRef = null
      endedHandlerRef = null
    },
  }
})()

// 从视频数据中提取合集相关信息
const getVideoInformation = (data: any) => {
  const collectionType = getCollectionType(data)
  switch (collectionType) {
    case CollectionType.Season:
      return {
        aid: data.aid,
        bvid: data.bvid,
        cid: data.cid,
        videoTitle: data.title,
        title: lodash.get(data, 'ugc_season.title', data.title),
        owner: data.owner,
      }
    case CollectionType.Multi:
      return {
        aid: data.aid,
        bvid: data.bvid,
        cid: data.cid,
        videoTitle: getCurrentPageItem(data)?.part,
        title: data.title,
        owner: data.owner,
      }
    default:
      return null
  }
}

// 获取视频时长（秒）
const getVideoDuration = (data: any) => {
  const collectionType = getCollectionType(data)
  switch (collectionType) {
    case CollectionType.Season:
      return getCurrentPageItem(data)?.duration || getPages(data)[0]?.duration || 0
    case CollectionType.Multi:
      return getCurrentPageItem(data)?.duration || 0
    default:
      return 0
  }
}

// 显示继续观看提示弹层
let promptVm: any = null
const destroyPrompt = () => {
  promptVm?.$el?.remove?.()
  promptVm?.$destroy?.()
  promptVm = null
}
const renderPrompt = async (
  show: boolean,
  videoTitle: string,
  lastSeconds: number,
  onJump: () => void,
  onStay: () => void,
) => {
  destroyPrompt()
  const Prompt = await import('./ContinuePrompt.vue').then(m => m.default as any)
  promptVm = new Prompt({
    propsData: { show, videoTitle, lastSeconds, onJump, onStay },
  }).$mount()
  document.body.insertAdjacentElement('beforeend', promptVm.$el)
  return promptVm
}

// 判断当前视频是否为上次记录的视频
const isJumpWrap = (collectionType: CollectionType, last: any, current: any, data: any) => {
  if (collectionType === CollectionType.Season) {
    // 判断当前视频是否为上次记录的视频（合集）
    if (last.aid === current.aid && last.bvid === current.bvid && last.cid === current.cid) {
      return true
    }
    // 上次记录视频为播放完成
    if (!last.playFinished) {
      if (last.durationSec === current.durationSec) {
        return true
      }
      return false
    }
    // 当前视频是上次播放完成视频的下一个视频
    const season = getSeasonEpisodes(data)
    if (season.length === 0) {
      return false
    }
    const nextIndex = season.findIndex((p: any) => p.cid === last.cid) + 1
    if (season.length <= nextIndex) {
      return false
    }
    return season[nextIndex].cid === current.cid
  }
  if (collectionType === CollectionType.Multi) {
    // 判断当前视频是否为上次记录的视频（分P）
    if (last.page === current.page) {
      return true
    }
    if (!last.playFinished) {
      return false
    }
    if (last.page + 1 === current.page) {
      return true
    }
  }
  return false
}

const getTrackControlItem = () =>
  document.querySelector(
    '.be-video-control-bar-extend [data-name="collectionProgressTrack"]',
  ) as HTMLElement | null

const setTrackControlItemVisible = (visible: boolean) => {
  const el = getTrackControlItem()
  if (!el) {
    return
  }
  el.style.display = visible ? '' : 'none'
}

// 当跟踪合集数量超过阈值时，弹出清理窗口供用户选择删除
const checkTrackedLimitAndPrompt = async () => {
  try {
    const {
      options: { maxTracked },
    } = getComponentSettings<ComponentOptions>('collectionProgress')
    const store = readStore()
    if (store.collections.length >= maxTracked) {
      const { showDialog } = await import('@/core/dialog')
      showDialog({
        title: '跟踪合集数量过多需清理',
        content: () => import('./TrackedCleanup.vue'),
        contentProps: {
          items: store.collections.map(it => ({
            id: it.id,
            title: it.title || it.last?.videoTitle || `${it.last?.aid || ''}`,
            jumpLink:
              it.collectionType === CollectionType.Season
                ? `https://www.bilibili.com/video/${it.last.bvid}`
                : `https://www.bilibili.com/video/${it.last.bvid}?p=${it.last.page}`,
          })),
          onRemove: (id: string) => removeCollection(id),
        },
      })
    }
  } catch (e) {
    logError(e)
  }
}

// 添加前校验阈值，超限则弹窗并阻止继续添加
const ensureTrackedLimitOk = async (): Promise<boolean> => {
  try {
    const {
      options: { maxTracked },
    } = getComponentSettings<ComponentOptions>('collectionProgress')
    const store = readStore()
    await checkTrackedLimitAndPrompt()
    if (store.collections.length >= maxTracked) {
      return false
    }
    return true
  } catch (e) {
    logError(e)
    return false
  }
}

// 组件入口：注册控制栏按钮，监听URL与视频切换事件
const entry = async () => {
  let trackButton: {
    name: string
    displayName: string
    icon: string
    order: number
    action: (event: MouseEvent) => Promise<void>
  }
  const updateTrackButton = (tracked: boolean, visible: boolean) => {
    trackButton.displayName = tracked ? '取消跟踪合集' : '跟踪合集'
    trackButton.icon = tracked ? 'mdi-bookmark-off' : 'mdi-bookmark'
    setTrackControlItemVisible(visible)
  }

  trackButton = {
    name: 'collectionProgressTrack',
    displayName: '跟踪合集',
    icon: 'mdi-bookmark',
    order: 0,
    action: async () => {
      try {
        const data = await fetchView(unsafeWindow.aid, unsafeWindow.bvid, unsafeWindow.cid)
        const id = resolveCollectionId(data)
        if (!id) {
          Toast.info('当前视频不属于合集或分P', '合集进度跟踪', 3000)
          return
        }
        const { aid: daid, bvid, cid: dcid, videoTitle, title, owner } = getVideoInformation(data)
        const page = getCurrentPage(data)
        const existed = Boolean(getCollection(id))
        if (existed) {
          const { showDialog } = await import('@/core/dialog')
          const dialog = showDialog({
            title: '取消合集跟踪',
            content: () => import('./ConfirmContent.vue'),
            contentProps: {
              message: `确定要取消对“${title}”的合集跟踪吗？`,
              onConfirm: () => {
                removeCollection(id)
                timeupdateTracker.detach()
                updateTrackButton(false, true)
                Toast.success('已取消该合集的跟踪', '合集进度跟踪', 2000)
              },
              onCancel: null,
            },
          })
          setTimeout(() => (dialog.open = true))
          return
        }
        const allowAdd = await ensureTrackedLimitOk()
        if (!allowAdd) {
          return
        }
        upsertCollection({
          id,
          title,
          last: {
            aid: `${daid}`,
            bvid,
            cid: dcid,
            videoTitle,
            page,
            positionSec: sec(await secondsFromPlayer()),
            durationSec: getVideoDuration(data),
            updatedAt: nowIso(),
            playFinished: false,
          },
          meta: { up_uid: lodash.get(owner, 'mid'), up_name: lodash.get(owner, 'name') },
          collectionType: getCollectionType(data),
          lastWatchTime: new Date().getTime(),
        })
        trackButton.displayName = '取消跟踪合集'
        trackButton.icon = 'mdi-bookmark-off'
        timeupdateTracker.attach(id)
        Toast.success('已开始跟踪该合集', '合集进度跟踪', 2000)
      } catch (e) {
        Toast.error(`开启失败: ${e.message}`, '合集进度跟踪', 3000)
      }
    },
  }

  await addControlBarButton(trackButton)

  // 进入或切换页面时：提示是否跳转，并更新按钮状态
  const handleUrlChange = async () => {
    timeupdateTracker.detach()
    destroyPrompt()

    const { aid, cid } = unsafeWindow
    if (!aid || !cid) {
      updateTrackButton(false, false)
      return
    }
    try {
      const data = await fetchView(aid, unsafeWindow.bvid, cid)
      const id = resolveCollectionId(data)
      if (!id) {
        updateTrackButton(false, false)
        return
      }
      const tracked = Boolean(getCollection(id))
      updateTrackButton(tracked, true)
      // 未跟踪合集时，不提示
      if (!tracked) {
        return
      }
      const {
        options: { autoJump = true },
      } = getComponentSettings<ComponentOptions>('collectionProgress')
      const { aid: daid, bvid, cid: dcid, videoTitle } = getVideoInformation(data)
      const page = getCurrentPage(data, cid)
      const current = {
        aid: `${daid}`,
        bvid,
        cid: dcid as number,
        page,
        durationSec: getVideoDuration(data),
      }
      const record = getCollection(id)
      if (!record?.last) {
        timeupdateTracker.attach(id)
        return
      }
      const { last } = record
      const onJumpWrap = async () => {
        if (record.collectionType === CollectionType.Multi) {
          navigateTo(last.bvid, last.page)
        } else {
          navigateTo(last.bvid)
        }
        destroyPrompt()
      }
      const onStayWrap = async () => {
        timeupdateTracker.detach()
        upsertCollection({
          id,
          last: {
            aid: `${daid}`,
            bvid,
            cid: dcid,
            videoTitle,
            page,
            positionSec: 0,
            durationSec: current.durationSec,
            updatedAt: nowIso(),
            playFinished: false,
          },
          lastWatchTime: new Date().getTime(),
        })
        destroyPrompt()
        timeupdateTracker.attach(id)
      }
      const requiresJumpConfirmation = !isJumpWrap(record.collectionType, last, current, data)
      if (requiresJumpConfirmation) {
        // 只在原本需要用户手动点击“跳转”的场景下自动确认跳转
        if (autoJump) {
          await onJumpWrap()
          return
        }
        await renderPrompt(true, last.videoTitle, last.positionSec || 0, onJumpWrap, onStayWrap)
        return
      }
      timeupdateTracker.detach()
      const resumePosition =
        last.playFinished || last.positionSec === last.durationSec ? 0 : last.positionSec || 0
      upsertCollection({
        id,
        last: {
          aid: `${daid}`,
          bvid,
          cid: dcid,
          videoTitle,
          page,
          positionSec: resumePosition,
          durationSec: current.durationSec,
          updatedAt: nowIso(),
          playFinished: false,
        },
        lastWatchTime: new Date().getTime(),
      })
      seekPlayer(resumePosition)
      timeupdateTracker.attach(id)
    } catch (e) {
      logError(e)
    }
  }
  await handleUrlChange()
  urlChange(handleUrlChange)
}

export const component = defineComponentMetadata({
  name: 'collectionProgress',
  displayName: '合集进度跟踪',
  author: { name: 'dklsgui', link: 'https://github.com/dklsgui' },
  tags: [componentsTags.utils, componentsTags.video],
  description: { 'zh-CN': desc },
  urlInclude: playerUrls,
  options: {
    autoJump: {
      defaultValue: true,
      displayName: '在需要确认跳转时自动跳转',
    },
    maxTracked: {
      defaultValue: 500,
      displayName: '最大跟踪合集数量',
      validator: (value: number, oldValue: number) => {
        const n = Math.round(Number(value))
        if (!Number.isFinite(n) || n < 1 || n > 1000 || readStore().collections.length > n) {
          return oldValue
        }
        return n
      },
    },
  },
  entry,
})
