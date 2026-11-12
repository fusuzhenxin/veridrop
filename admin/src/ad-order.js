export const ORDER_STATUS = { active: "档期内", scheduled: "待开始", expired: "档期结束", cancelled: "已取消" };
export const PAYMENT_STATUS = { unpaid: "未收款", partial: "部分收款", paid: "已收齐", refunded: "已全额退款" };
export const amountText = cents => new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(Number(cents || 0) / 100);
export const newRequestKey = () => crypto.randomUUID();
