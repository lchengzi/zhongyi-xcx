const catalogData = require("./data/ingredients");
const storage = require("./utils/storage");
const privacy = require("./utils/privacy");

App({
  onLaunch() {
    storage.reconcileCatalogIds((catalogData.ingredients || []).map((item) => item.id));
  },

  globalData: {
    productName: "中医食养筛选助手",
    productMode: "food-education",
    // 仅保存在本次小程序进程内，不写入本地存储或上传。
    sessionSafetyProfile: privacy.createEmptySessionSafetyProfile(),
    // 用户主动确认的已确诊目标只保存在当前进程内，不写入 storage、URL 或分享参数。
    sessionRecipeAcknowledgements: {},
    // 仅用于让缓存页面在隐私删除后丢弃旧表单，不包含任何健康内容。
    sessionDataRevision: 0
  }
});
