<template>
  <!-- 合集继续观看提示弹层 -->
  <div class="be-collection-progress-prompt" :class="{ show }">
    <div class="card">
      <div class="title">继续观看合集</div>
      <div class="message">上次观看到 {{ videoTitle }} {{ lastTimeText }}，是否跳转？</div>
      <div class="actions">
        <button class="primary" @click="onJump">跳转至上次位置</button>
        <button class="secondary" @click="onStay">不进行跳转</button>
      </div>
    </div>
  </div>
</template>
<script lang="ts">
import { PropType } from 'vue'

export default Vue.extend({
  props: {
    // 是否显示提示弹层
    show: { type: Boolean, default: false },
    // 合集标题，用于文案展示
    videoTitle: { type: String, default: '' },
    // 上次观看的秒数，用于文案展示
    lastSeconds: { type: Number, default: 0 },
    // 点击“跳转至上次位置”事件处理器
    onJump: { type: Function as PropType<(e: MouseEvent) => void>, required: true },
    // 点击“不进行跳转”事件处理器
    onStay: { type: Function as PropType<(e: MouseEvent) => void>, required: true },
  },
  computed: {
    // 将秒数格式化为 mm:ss 或 hh:mm:ss
    lastTimeText(): string {
      const s = Math.max(0, Math.floor(this.lastSeconds))
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      const ss = s % 60
      const pad = (n: number) => `${n}`.padStart(2, '0')
      return h > 0 ? `${pad(h)}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`
    },
  },
})
</script>
<style lang="scss" scoped>
.be-collection-progress-prompt {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 100003;
  &.show {
    display: flex;
  }
  .card {
    background: #1b1b1b;
    color: #eee;
    padding: 16px 20px;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    min-width: 280px;
    .title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .message {
      font-size: 14px;
      margin-bottom: 12px;
    }
    .actions {
      display: flex;
      gap: 8px;
      .primary,
      .secondary {
        padding: 6px 12px;
        border-radius: 4px;
        border: none;
        cursor: pointer;
      }
      .primary {
        background: #00aeec;
        color: #fff;
      }
      .secondary {
        background: #333;
        color: #ddd;
      }
    }
  }
}
</style>
