---
name: wealth
description: 模拟理财购买与资金筹划，余额不足时询问差额转账，到账后单独确认购买
---

# 本次办理的目标
模型依据此Skill编排，业务系统Mock负责资金、回执和约束。本示例唯一产品为 demo-wealth-a（演示理财A），金额按整数分传工具；3000元=300000分。只使用用户明确提供的购买金额，不擅自改变金额。

1. 先调用 call_mcp(operation=wealth_plan, arguments={productId,amountFen})。以返回的 availableFen、fundingFen、shortfallFen、canPurchase 和 summary 为真实依据；不能凭用户“已到账”的话跳过查询。
2. canPurchase=false 且 shortfallFen>0：向用户说明资金不足，提出从本人模拟储蓄账户转入差额。直接调用 confirm_action(operation=transfer, arguments={productId,purchaseAmountFen:原购买金额,amountFen:返回的shortfallFen}) 来询问是否转账。不要自行执行。若fundingFen不足，不请求无法执行的转账，结束查询并说明资金不足。
3. 用户同意转账后，调用 call_mcp(operation=transfer)，参数必须与确认完全相同。转账成功只是中间步骤，不能当作购买成功。随后再次调用 wealth_plan 核对原产品和原购买金额；不可重新重复转账。
4. canPurchase=true：调用 confirm_action(operation=purchase, arguments={productId,amountFen:原购买金额})。即使已经同意转账，也必须再确认购买。用户同意后以相同参数调用 call_mcp(operation=purchase)，返回真实购买回执才结束。
5. 查询余额资金情况但没有购买要求时，调用 wealth_plan 后用 finish 正常收束。
6. 用户拒绝转账或拒绝购买：不执行所拒绝的操作，调用 finish 或依据真实拒绝回执自然结束。拒绝购买不撤销已成功的转账，必须如实保留该结果。
7. 写操作状态unknown时禁止重发，也不得接着购买；仅按原key核对receipt。当前Demo核对未知转账结果后结束本次任务；后续购买重新发起并重新确认。失败和unknown都不能宣称购买成功。

服务地址、本人账户和客户身份由配置/固定参数提供，不让模型编造。主Agent可选择其他业务Skill；未结束的任务切换仍遵循A→B两层和恢复复核。

## 精确收束契约
调用finish必须使用 call_mcp(operation="finish", arguments={})，输入是空对象。不要传summary、message或其他字段；summary是工具输出，由脚本汇总真实结果，不是模型输入。已验证查询或真实拒绝后应调用finish收束，普通文字不代表任务已成功结束。
