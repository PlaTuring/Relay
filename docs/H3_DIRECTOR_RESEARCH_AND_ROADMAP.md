# Relay H3 导播台：全网调研结论与产品路线

更新日期：2026-08-29

## 结论

旧版导播台本质上是“创建工作流”的多镜头表单版：它能把一个长项目拆成若干 H3 片段，但缺少真正制作系统应有的稳定镜头身份、制作设定、版本状态和可追溯编译结果。

社区中成熟的 H3 导播台通常还包含时间线、素材轨、镜头链、局部重做、缓存、预览和任务执行。Relay 不能原样复制这些功能，因为 Relay 的产品边界是本地安装、配置、工作流编译和交接；它不向 ComfyUI 提交 `/prompt`，不自动点击 Run，也不替 MiniMax H3 生成视频或原生音频。

因此 Relay 的正确方向是“离线前期制作与工作流编译控制台”，而不是另一个生成后端。

## 本轮已落地（Alpha 22）

- 每个镜头有稳定 ID；调整项目总时长时，未改变的镜头仍保持原身份。
- 增加角色/服装/道具、场景/世界观、视觉风格三类制作设定。
- 增加逐镜头摄影语言、声音提示、转场/连续性备注；空白字段不会被写成虚构指令。
- 镜头分别显示“已编译”或“待重新编译”。
- 保存草稿与编译成功是两个独立状态；保存不再错误地把新修改标成已编译。
- 编译期间继续编辑时，只认提交瞬间的不可变快照，新内容仍保持待重新编译。
- 编译快照覆盖模式、素材、提示词、画布、分辨率、种子、采样和所有 Ref2VA 字段。
- 空的 `overall_soundscape` 与 `non_diegetic_music` 保持真正空值，可直接提交；不会替用户写成“无”“静音”或 `N/A`。
- 兼容旧版草稿，12 段时间线在窄窗口中可横向滚动。

## 全网产品形态对比

### H3 社区导播台

- AIMixer Director 已包含多段时间线、自动/手动分段、多种 H3 模式、素材组、选段运行、缓存、跨段上下文、放大和报告。
- dmulxw Director 强调真正的多轨时间线、拖放素材、裁剪、逐镜提示、预览、重做与镜头接续。
- Balu Multimodal Director 采用主轨/动作轨/音频轨、可拖拽缩放片段、吸附、播放头和自动参考标签。

这些项目证明用户真正需要的是“镜头、素材、版本和状态之间的关系”，而不是更多大文本框；但其自动运行、重做、缓存生成结果等能力不属于 Relay 当前边界。

### 成熟影视与生成式产品

- StudioBinder：场景、镜头清单、分镜与拍摄计划是一套结构化数据，而不是单个提示词。
- LTX Elements / Google Flow Assets：人物、地点、物件应成为可复用实体，避免每个镜头反复描述并产生漂移。
- Google Flow History：创作结果应保留不可变历史，支持回看和恢复。
- Adobe Firefly：Boards、Timeline、Graph 是不同视图，分别服务构思、时序和节点关系。
- OpenTimelineIO：剪辑时间线应能以开放格式交换，而不绑定某一个软件。

## 下一阶段建议

### P1：制作数据层

1. 可复用素材/实体库：角色、地点、道具、参考图与声音素材只定义一次，镜头通过引用使用。
2. 项目层级：项目 → 场景/段落 → 镜头；长视频不再是扁平的 12 个文本框。
3. 连续性矩阵：对人物外观、服装、道具、运动方向、时间、光线和声音逐镜显示继承与覆盖。
4. 不可变修订：每次编译生成 revision；修改后产生新 revision，允许比较与恢复。
5. Take/尝试台账：只记录用户在外部 ComfyUI 生成后的文件、备注与评分，不由 Relay 自动运行生成。

### P2：审片与交换

1. A/B 版本对比、逐镜备注、通过/需修改状态。
2. JSON/CSV 镜头清单导出；在边界稳定后增加 OpenTimelineIO 导出。
3. 本地成片索引和代理预览；只读取用户指定的结果，不修改媒体、不上传云端。
4. 资源和显存预算面板：估算模型、缓存、每段时长和画布的磁盘/显存压力，并明确“建议而非性能保证”。

## 明确不加入

- 自动替用户创作、翻译或扩写提示词。
- 自动向 ComfyUI 提交队列、自动点击 Run 或后台生成媒体。
- 未经验证自动安装未知第三方节点。
- 依赖第三方 API 才能完成基础工作流编译。

## 主要资料

- [AIMixer ComfyUI MiniMax H3 Director](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director/blob/main/README.md)
- [dmulxw MiniMax H3 Director](https://github.com/dmulxw/comfyui-minimaxh3-director)
- [Balu MiniMax H3 Multimodal Director](https://github.com/balu112121/ComfyUI-MiniMax-H3-Multimodal-Director)
- [MiniMax H3 官方仓库](https://github.com/MiniMax-AI/MiniMax-H3)
- [StudioBinder Shot List & Storyboard](https://www.studiobinder.com/shot-list-storyboard/)
- [LTX Elements](https://ltx.io/blog/getting-started-with-elements)
- [Google Flow Assets](https://support.google.com/flow/answer/16935308?hl=en)
- [Google Flow History](https://support.google.com/flow/answer/16935718?hl=en)
- [Adobe Firefly Workspace](https://helpx.adobe.com/firefly/web/get-started/access-the-app/firefly-workspace-overview.html)
- [OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO)
