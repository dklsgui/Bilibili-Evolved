<template>
  <div class="tracked-cleanup">
    <div class="list">
      <div v-for="it in list" :key="it.id" class="row">
        <div class="text">
          <a :href="it.jumpLink" target="_blank" class="jump">{{ it.title }}</a>
        </div>
        <button class="danger" @click="remove(it.id)">删除</button>
      </div>
    </div>
    <div class="actions">
      <button class="normal" @click="close">关闭</button>
    </div>
  </div>
</template>
<script lang="ts">
export default Vue.extend({
  props: {
    items: { type: Array, default: () => [] },
    onRemove: { type: Function, required: true },
  },
  data() {
    return {
      list: [] as Array<{ id: string; title: string; jumpLink: string }>,
    }
  },
  watch: {
    items(val: any[]) {
      this.list = [...val]
    },
  },
  created() {
    this.list = [...(this.items as any[])]
  },
  methods: {
    remove(id: string) {
      this.onRemove?.(id)
      this.list = this.list.filter(it => it.id !== id)
    },
    close() {
      this.$emit('dialog-close')
    },
  },
})
</script>
<style lang="scss" scoped>
.tracked-cleanup {
  padding: 12px 16px 16px;
  .title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .list {
    max-height: 320px;
    overflow: auto;
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 0;
      border-bottom: 1px dashed #444;
      .text {
        font-size: 14px;
      }
      .id {
        color: #888;
        font-size: 12px;
      }
      .danger {
        padding: 6px 12px;
        border-radius: 4px;
        border: none;
        cursor: pointer;
        background: #f33;
        color: #fff;
      }
    }
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 8px;
    .normal {
      padding: 6px 12px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      background: #333;
      color: #ddd;
    }
  }
}
</style>
