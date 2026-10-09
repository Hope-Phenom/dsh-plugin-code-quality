# dsh-plugin-code-quality

一个 [DeepSeek Harness](https://github.com/deepseek-ai) 插件，在 `/` 菜单里加上两个代码质量命令：

| 命令 | 作用 | 谁能调用 |
|---|---|---|
| `/simplify [目标]` | 对你改动过的代码做**不改变行为**的清理：复用已存在的辅助函数、去掉多余的复杂度、削减浪费的工作、把做错层次的改动挪回去。**不是**找 bug。 | 你 **和** 模型 |
| `/code-review [级别] [--fix] [目标]` | 用多个相互独立的审查角度在 diff 里找**真实正确性缺陷**，每条候选都先经独立验证再上报，存活下来的按严重度排序。 | 仅你 |
| `/review …` | `/code-review` 的别名，行为与指令完全相同。 | 仅你 |

两个命令沿用主流代码审查工具已经收敛的设计，并按 DSH 的工具、指令文件布局与 subagent 模型做了适配。

---

## 安装

```powershell
dsh plugin --profile <你的 profile> add @hope_phenom/dsh-plugin-code-quality
```

然后重启该 profile（或让 HMR 接管），在输入框敲 `/` —— `simplify`、`code-review`、`review` 会出现在 skills 分组下。

本地开发联调：

```powershell
dsh plugin --profile <你的 profile> add F:\path\to\dsh-plugin-code-quality
```

### 前置条件

- DSH 组合了 `@deepseek-ai/dsh-skill` 与 `@deepseek-ai/dsh-client-ui-skill`。两者都在随包发布的 standard preset 里，原装安装即有。
- Node.js ≥ 20。
- 本插件**没有任何依赖，也没有 peer 依赖**——它不 import 任何 DSH 包，只通过宿主传入的 `ctx` 对象与宿主交互。

---

## 用法

### `/simplify`

```text
/simplify                       # 清理自上游分支以来的全部改动
/simplify src/parser.ts         # 只看某个路径
/simplify 421                   # 改成审查某个 PR，而不是本地 diff
```

范围解析顺序：你指定的目标 → `git diff '@{upstream}...HEAD'` → `main...HEAD`（退到 `origin/main`、`master`）→ `HEAD~1`。工作区未提交的改动与未跟踪文件也会纳入，因为这个命令最有用的时机是**提交之前**。如果什么都没改，它会直说并停下。

四个独立审查者看同一个 diff——**Reuse（复用）**、**Simplification（简化）**、**Efficiency（效率）**、**Altitude（层次）**。一条发现只有在能给出**具体替换方案**时才算数：该调用的现成辅助函数、更简单的写法、更省的替代方案、或者特例该收敛进哪个通用机制。填不出这一栏的发现会在到达你之前就被丢掉。

存活下来的发现去重后直接应用。凡是会改变预期行为、或需要改动 diff 之外代码的，一律跳过并如实说明跳过原因，而不是跟你辩论。

### `/code-review`

```text
/code-review                    # 默认级别的均衡审查
/code-review high               # 更多角度、更高上报上限、倾向召回的验证
/code-review max --fix          # 最宽的扫描，然后应用发现
/code-review high src/parser.ts # 级别 + 目标
```

级别词是模型从**你自己的消息里**读出来的——没有参数解析器，因为这个命令是以指令形式下发的。

| 级别 | 正确性角度 | 清理角度 | 每个 finder 候选上限 | 上报上限 | 验证倾向 |
|---|---|---|---|---|---|
| `low` | 3 | 0 | 4 | 5 | 只保留 `CONFIRMED` |
| `medium`（默认） | 5 | 2 | 6 | 8 | 均衡 |
| `high` | 6 | 4 | 8 | 12 | 保留 `PLAUSIBLE` |
| `max` | 6 | 4 + 补漏 | 8 | 20 | 保留 `PLAUSIBLE` |

共定义六个正确性角度，由级别决定跑几个——`low` 跑三个、`medium` 跑五个、`high` 与 `max` 跑全部六个：

| id | 角度 | 它问的问题 |
|---|---|---|
| C1 | 逐行 hunk 扫描 | 是什么输入、状态、时序或平台会让这一行产生错误结果？（含被改动函数里未改动的那几行） |
| C2 | 被删除行为审计 | 被删掉或替换的每一行原先保证了什么不变式？新代码在哪里重新建立它？ |
| C3 | 跨文件契约追踪 | 这次改动是否通过新的前置条件、返回值形状、抛错路径或时序要求打断了某个调用方？ |
| C4 | 语言与框架陷阱 | 这次 diff 里真实出现的语言/框架，踩中了哪个经典陷阱？ |
| C5 | 异步、并发与资源生命周期 | 竞态、漏掉的 `await`、启动了却没人等的活儿、错误路径跳过清理、活得比属主还久的监听器。 |
| C6 | 错误路径与边界 | 空集合、零与负数、null、多字节文本、溢出、超时、部分写入、超大载荷。 |

每条候选随后交给一个**独立验证者**，它的指令是**尝试反驳**这条候选，并必须回答 `CONFIRMED` / `PLAUSIBLE` / `REFUTED`。在 `high` 与 `max` 下，最后还有一个补漏审查者拿到已验证清单，只找清单上没有的东西。当上报上限需要削减时，正确性发现优先于清理、层次与规范类发现。

输出是每条发现一行：

```text
src/parser.ts:118 —— 重试循环在循环体内重置了 `attempts`；持续 503 会无限重试
```

如果没有任何发现通过验证，它会用一行如实说明，而不是把报告灌水。`--fix` 会在上报之后应用存活的发现；不加这个参数，命令永远不会改文件。

---

## 实现方式

插件没有客户端一半，没有工具、没有服务、没有 HTTP 路由。`lib/index.js` 只做一件事：

```js
export const name = 'dsh-plugin-code-quality'
export const inject = ['skills']

export function apply(ctx) {
  for (const skill of SKILLS) ctx.skills.register(skill)
}
```

### 为什么用 skill 而不是 `ctx.commands`

DSH 给插件两条加 `/` 命令的路，它们并不等价：

- **`ctx.commands.register()`** 发布的是**宿主命令**。它的 handler 直接对 agent 生效，默认**不产生任何模型消息**——想让模型干活的命令必须自己伪造一条用户消息提交上去。
- **`ctx.skills.register()` 且 `userInvocable: true`** 发布的是 **skill**。composer 把你的消息**原样**送出（连 `/simplify` 这个 token 一起），宿主在 pre-step 边界把 skill 正文作为 `<skill_content>` 指令块追加进去。

后者正好是这两个命令需要的载体：它们的内容**本身就是**一份指令文档，你输入的目标文本能完整到达，也不需要伪造一条"假装是你"的消息。

### 调用策略

`simplify` 注册为 `{ modelInvocable: true, userInvocable: true }`，所以模型在自己的 skill 目录里也看得到、可以主动调用——"做一次不改变行为的清理"是 agent 自己判断需要时完全可以做的事。

`code-review` 与 `review` 注册为 `{ modelInvocable: false, userInvocable: true }`。它们从不进入模型的目录，也无法被模型自行触发；`/` 菜单是它们唯一的入口，DSH 会在菜单里把它们标成"仅限用户"。

### `/review` 是第二次注册，不是指针

`@deepseek-ai/dsh-skill` 的运行时注册只以 `name` 为键，没有别名字段（DSH 的本地化命令别名只存在于宿主命令，且靠一方 `definitionId` 定位）。因此 `/review` 注册为它自己的 skill，但**按引用**共享 `code-review` 的正文，两者不可能漂移。代价是 `/` 菜单里多一行。

---

## 设计说明

这两个命令沿用了一套代码审查工具已经大致收敛的做法：把审查拆成若干相互独立的角度，让任何单次扫描都不必样样精通；每条候选在上报之前都要过一遍独立验证；上报数量设上限，免得一堆边缘发现把真正的问题埋掉。

在此基础上，这里有几处是超出该做法的：

- **角度。** 除了常见的逐行、被删除行为、跨文件三个角度，还加入了 `C5`（异步、并发与资源生命周期）与 `C6`（错误路径与边界）——这两类承载的真实缺陷量很大，而泛泛的扫描容易略过。
- **扇出工具。** 审查者以 `subagent` 子代理运行，并**钉死 `run_in_background: false`**。DSH 的 standard preset 把该工具配置成 `continuable`，不钉的话它会返回一个 id、逼父级去轮询，而不是在同一个 step 里交回一整轮发现。所有 finder 调用在同一条消息里发出，以并发执行。
- **努力级别。** DSH 的 skill 正文是静态的，没有宿主 API 可以选级别，因此级别由模型从你的消息里解析，对照上表。
- **指令文件。** DSH 加载 `$DSH_HOME/AGENTS.md`，以及按目录组成的项目链 `AGENTS.md` 与其 `AGENTS.local.md` 叠加层。这条链通常会自动注入，因此规范类角度只在没注入时才去直接读文件。
- **范围。** 审查只针对你的本地 diff，报告留在对话里。不会往 PR 上发评论，也不会发布到别处。

非官方社区项目，MIT 许可证，无商业目的。

---

## 开发

```powershell
npm test          # node --test：skill 契约、插件接线、提示词合规
npm run verify    # 同样检查的可读 PASS/FAIL 报告
```

`test/prompts.test.js` 是 `docs/PORT-SPEC.md` §7 的执行点：任何正文丢掉 subagent 扇出契约、少了某个判定标签、开始自行输出 prompt 框架、混入厂商名、或超出字数预算，都会让构建失败。

## 许可证

[MIT](LICENSE)
