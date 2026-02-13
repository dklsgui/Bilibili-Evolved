<template>
  <div class="confirm-content">
    <div class="message">{{ message }}</div>
    <div class="actions">
      <button class="danger" @click="confirm($event)">确认取消</button>
      <button class="normal" @click="cancel($event)">保留跟踪</button>
    </div>
  </div>
</template>
<script lang="ts">
export default Vue.extend({
  props: {
    message: { type: String, default: '' },
    onConfirm: { type: Function, required: true },
    onCancel: { type: Function, default: null },
  },
  methods: {
    confirm(e: MouseEvent) {
      this.onConfirm?.(e)
      this.$emit('dialog-close')
    },
    cancel(e: MouseEvent) {
      this.onCancel?.(e)
      this.$emit('dialog-close')
    },
  },
})
</script>
<style lang="scss" scoped>
.confirm-content {
  padding: 12px 16px 16px;
  .message {
    font-size: 14px;
    margin-bottom: 12px;
  }
  .actions {
    display: flex;
    gap: 8px;
    .danger,
    .normal {
      padding: 6px 12px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
    }
    .danger {
      background: #f33;
      color: #fff;
    }
    .normal {
      background: #333;
      color: #ddd;
    }
  }
}
</style>
