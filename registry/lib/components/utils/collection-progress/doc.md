合集进度跟踪（Collection Progress）

目标
- 为“合集/分P”视频提供跨分集的观看进度跟踪与继续播放能力。
- 在进入合集或包含分P的视频时，提示是否跳转到上次观看位置；支持自动跳转或手动确认。
- 在观看结束或自动切到下一集时，更新对应合集的进度记录。

术语与范围
- 合集：B站 UGC 合集（season/series/collection）与普通视频的分P结构，统一称为“合集”。
- 分P：同一稿件下的多个 `cid`（`data.videos > 1`）。
- 范围：仅针对 UGC 合集与分P视频；番剧区（Bangumi/PGC）不在本插件范围内。

功能概述
- 合集识别：判断当前视频是否属于合集或具备分P结构；符合条件则显示“进度跟踪”按钮。
- 记录与存储：在用户开启跟踪后，记录合集标识与上次观看位置，存入 `localStorage`。
- 进入合集时提示：当用户从合集入口或进入属于该合集的视频时，提示是否跳转到上次观看位置。
- 进度更新：当当前分集观看完成或自动切到下一集时，更新对应合集的最新分集与时间点。

合集判定逻辑
- 首选接口：`GET https://api.bilibili.com/x/web-interface/view?aid={aid}|bvid={bvid}[&cid={cid}]`
- 判定条件：
  - 分P：`data.videos > 1`，`data.pages` 中存在多个 `cid`。
  - UGC 合集：存在 `data.ugc_season`（含 `season_id`/`title`/`sections` 等）。
- 补充场景：在合集详情页（`/seriesdetail`、`/collectiondetail`）可通过 URL 参数 `sid` 识别合集 ID；必要时可调用：
  - `GET https://api.bilibili.com/x/series/archives?mid={uid}&series_id={sid}&only_normal=true&sort=desc&pn=1&ps=99999`

UI 与交互
- 入口按钮：当判定为合集时，在视频页面显著位置显示“进度跟踪”按钮（命名建议：`跟踪合集` 或 `继续合集`）。
- 跟踪开启：
  - 首次点击后，记录合集 ID（UGC：`season_id`；分P：以 `aid` 作为合集标识），并开始记录进度。
- 进入提示：
  - 当进入该合集下的任意分集，出现提示浮层：
    - 选项 A：`跳转至上次位置（xx:xx）`
    - 选项 B：`不进行跳转，保持当前分集`，并立即将记录更新为“当前分集 + 进入时间点”（可按 0 秒或当前播放点）。
  - 支持在设置里选择“自动跳转”或“总是提示”。
- 结束更新：
  - 播放器触发 `ended` 或切换到下一分集事件时，自动更新记录为下一分集的起始位置（或实际观看到的时间点）。

数据存储设计
- 键名：`localStorage['be:collection-progress:v1']`
- 结构：
  - `version`: `1`
  - `collections`: 数组或映射，元素示例：
    - `id`: 字符串（UGC：`season:{season_id}`；分P：`multi:{aid}`）
    - `title`: 合集标题（可选，用于显示）
    - `last`: 上次观看位置：
      - `aid`: 稿件 ID
      - `bvid`: 稿件 BVID（可选）
      - `cid`: 分P CID
      - `page`: 分P序号（可选）
      - `positionSec`: 上次观看秒数
      - `durationSec`: 时长（可选）
      - `updatedAt`: ISO 时间戳
      - `playFinished`: 是否播放完成（默认：`false`）
    - `next`: 预测的下一分集（可选）：`aid`/`cid`/`page`
    - `meta`: 其他信息（`up_uid`、`up_name` 等，便于显示与清理）
    - `collectionType`: 合集类型（`season`/`multi`/`none`）
- 读写策略：进入页面时读取；在用户确认或自动跳转后更新；在分集结束或切换后刷新。
  - 当选择“不进行跳转”时，更新记录为当前分集（`aid/bvid/cid/page`）与进入时间点（`positionSec`）。

页面时机与事件钩子
- 进入页面：监听 URL 变化（参考 `urlChange`），在 `document` 就绪后判定合集并渲染按钮/提示。
- 播放器事件：
  - 监听 `timeupdate` 以节流记录观看位置（例如每 10 秒写入一次）。
  - 监听 `ended`/“下一分集”事件以更新到下一分集（如可从 `data.pages` 或 `ugc_season.sections` 推断下一项）。

跳转策略
- 分P：若 `aid` 相同，直接定位到对应 `cid` 分P并跳转到 `positionSec`。
- UGC 合集：根据 `season_id` 查找该合集下的分集列表，定位到已记录的分集（`aid/cid`）与时间点；若分集已失效则回退到首个有效分集并提示。

设置项（后续实现）
- 是否自动跳转到上次位置（默认：提示）。
- 跳转确认框样式与位置（播放器内/页面浮层）。
- 记录粒度（时间点写入间隔）。
- 管理记录（列表视图、导出、清空、按合集删除）。

接口参考
- `x/web-interface/view`：稿件与分P信息（`aid`/`bvid`/`cid`/`videos`/`ugc_season`）。
- `x/series/archives`：合集下稿件列表（系列页）。
- `x/player/wbi/v2`：播放相关附加信息（可选，用于章节或时长等辅助）。
