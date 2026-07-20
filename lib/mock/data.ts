import accountsJson from "@/data/accounts/accounts.json";
import openCliXhsHotTopics from "@/data/topics/xiaohongshu-opencli-hot.json";
import type { ProductionAccount } from "@/types/account";
import type { ContentProject, CopyCandidate, TitleCandidate } from "@/types/content";
import type { ImagePlanItem } from "@/types/image";
import type { Topic } from "@/types/topic";
import type { VideoScriptRow, VideoShotPlan } from "@/types/video";

export const accounts = accountsJson as ProductionAccount[];

export const dashboardStats = [
  { label: "待审选题", value: "168", delta: "+18", tone: "review" },
  { label: "待生成作品", value: "54", delta: "+12", tone: "pending" },
  { label: "待审核作品", value: "26", delta: "+6", tone: "review" },
  { label: "需重做", value: "8", delta: "-3", tone: "rework" },
  { label: "可发布", value: "43", delta: "+9", tone: "publishable" },
  { label: "已保存本地", value: "312", delta: "+31", tone: "saved" }
] as const;

export const todoItems = [
  { title: "复核白桃养肤记 9 图防晒备忘录", time: "10:30", status: "review" },
  { title: "完成叙妍欧尼吖敏感肌避坑选题审核", time: "11:20", status: "pending" },
  { title: "导出小红书补涂短视频分镜提示词", time: "14:00", status: "generating" },
  { title: "归档本周已通过图文项目", time: "17:30", status: "saved" }
] as const;

export const platformTasks = [
  { platform: "小红书", badge: "RED", target: 40, pending: 18, generating: 12, publishable: 9, completed: 29, drafts: 11, archived: 104, progress: 73 }
] as const;

export const latestProjects: ContentProject[] = [
  { id: "p1", title: "夏天通勤防晒喷雾，包里常备这一支", platform: "小红书", targetAccountId: "xhs_01_baitao_yangfuji", contentType: "小红书长图文", status: "review", updatedAt: "07-08 16:20", thumbnailLabel: "防晒喷雾" },
  { id: "p2", title: "为什么涂了防晒还是会晒黑", platform: "小红书", targetAccountId: "xhs_02_xuyan_ouniya", contentType: "备忘录科普", status: "generating", updatedAt: "07-08 15:42", thumbnailLabel: "晒黑原因" },
  { id: "p3", title: "油皮夏天怎么选不闷痘的防晒", platform: "小红书", targetAccountId: "xhs_03_cuntou_princess", contentType: "小红书素人种草", status: "publishable", updatedAt: "07-08 14:10", thumbnailLabel: "油皮防晒" },
  { id: "p4", title: "防晒补涂 20 秒口播脚本", platform: "小红书", targetAccountId: "xhs_04_xiaoying_niu", contentType: "小红书短视频", status: "saved", updatedAt: "07-08 11:26", thumbnailLabel: "补涂视频" },
  { id: "p5", title: "军训防晒避坑清单，先收藏再买", platform: "小红书", targetAccountId: "xhs_01_baitao_yangfuji", contentType: "小红书清单图文", status: "rework", updatedAt: "07-08 10:15", thumbnailLabel: "军训防晒" },
  { id: "p6", title: "日常防晒包内好物图文", platform: "小红书", targetAccountId: "xhs_02_xuyan_ouniya", contentType: "小红书生活方式图文", status: "pending", updatedAt: "07-07 19:35", thumbnailLabel: "包内好物" }
];

export const topicStats = [
  { label: "全部选题", value: "426", tone: "saved" },
  { label: "待审核", value: "168", tone: "review" },
  { label: "已通过", value: "142", tone: "approved" },
  { label: "已拒绝", value: "37", tone: "rejected" },
  { label: "已使用", value: "79", tone: "done" }
] as const;

export const topics: Topic[] = [
  { id: "t1", platform: "小红书", title: "夏天通勤防晒喷雾，包里常备这一支", contentType: "小红书长图文", likes: "2.8w", comments: "841", saves: "1.2w", risk: "低", priority: "P0", status: "pending", sourceAccount: "白桃养肤记参考库", fetchedAt: "07-08 09:12" },
  { id: "t2", platform: "小红书", title: "敏感肌防晒不要乱选，先看这 5 个点", contentType: "轻知识", likes: "3.4w", comments: "1,092", saves: "1.6w", risk: "中", priority: "P0", status: "approved", sourceAccount: "叙妍欧尼吖参考库", fetchedAt: "07-08 08:48" },
  { id: "t3", platform: "小红书", title: "带妆补防晒不要揉搓，先看这套流程", contentType: "小红书短视频", likes: "3.8w", comments: "904", saves: "1.7w", risk: "低", priority: "P1", status: "pending", sourceAccount: "补涂流程样本库", fetchedAt: "07-07 19:30" },
  { id: "t4", platform: "小红书", title: "军训防晒避坑清单，先收藏再买", contentType: "小红书清单图文", likes: "8.9w", comments: "2,103", saves: "4.5w", risk: "中", priority: "P0", status: "used", sourceAccount: "校园护肤参考库", fetchedAt: "07-07 18:05" },
  { id: "t5", platform: "小红书", title: "夏天防晒包里到底放什么", contentType: "小红书生活方式图文", likes: "5.7w", comments: "608", saves: "1.8w", risk: "低", priority: "P1", status: "approved", sourceAccount: "防晒包参考库", fetchedAt: "07-07 16:42" },
  { id: "t6", platform: "小红书", title: "通勤防晒常见误区，一篇讲清楚", contentType: "小红书科普图文", likes: "1.6w", comments: "322", saves: "7,820", risk: "低", priority: "P2", status: "pending", sourceAccount: "护肤笔记参考库", fetchedAt: "07-07 15:10" },
  { id: "t7", platform: "小红书", title: "防晒霜和防晒喷雾怎么搭配补涂", contentType: "备忘录科普", likes: "4.1w", comments: "1,317", saves: "2.5w", risk: "低", priority: "P0", status: "approved", sourceAccount: "防晒补涂样本库", fetchedAt: "07-08 10:02" },
  { id: "t8", platform: "小红书", title: "早八出门快速补防晒流程", contentType: "小红书短图文", likes: "2.2w", comments: "486", saves: "9,520", risk: "低", priority: "P1", status: "pending", sourceAccount: "通勤护肤参考库", fetchedAt: "07-08 10:28" },
  { id: "t9", platform: "小红书", title: "补防晒最容易踩的 3 个坑", contentType: "小红书口播短视频", likes: "9.8w", comments: "1,804", saves: "3.3w", risk: "中", priority: "P1", status: "rejected", sourceAccount: "补涂避坑样本库", fetchedAt: "07-06 21:15" },
  { id: "t10", platform: "小红书", title: "不泛白不搓泥的防晒，到底怎么选", contentType: "清单图文", likes: "3.1w", comments: "901", saves: "1.9w", risk: "低", priority: "P0", status: "used", sourceAccount: "油皮防晒样本库", fetchedAt: "07-08 11:05" },
  ...(openCliXhsHotTopics as Topic[])
];

export const referenceSources = [
  { id: "r1", platform: "小红书", title: "早八出门快速防晒流程，油皮也不怕闷", author: "油皮通勤日记", time: "2026-07-07", likes: "2.1w", saves: "9,832", comments: "642", status: "已解析", reason: "" },
  { id: "r2", platform: "小红书", title: "防晒喷雾补涂流程", author: "补涂参考库", time: "2026-07-06", likes: "8.7w", saves: "1.1w", comments: "1,240", status: "已解析", reason: "" },
  { id: "r3", platform: "小红书文本导入", title: "敏感肌夏天防晒避坑清单", author: "标题文本导入", time: "2026-07-08", likes: "-", saves: "-", comments: "-", status: "已导入文本", reason: "" }
] as const;

export const titleCandidates: TitleCandidate[] = [
  { title: "夏天通勤防晒喷雾，包里常备这一支", score: 96, tag: "高点击" },
  { title: "为什么涂了防晒还是会晒黑", score: 95, tag: "强痛点" },
  { title: "油皮夏天怎么选不闷痘的防晒", score: 93, tag: "科普向" },
  { title: "防晒霜和防晒喷雾怎么搭配补涂", score: 92, tag: "收藏向" },
  { title: "敏感肌防晒不要乱选，先看这 5 个点", score: 91, tag: "备忘录风" },
  { title: "早八出门快速补防晒流程", score: 90, tag: "素人感" },
  { title: "美白第一步其实是防晒", score: 89, tag: "高点击" },
  { title: "不泛白不搓泥的防晒，到底怎么选", score: 88, tag: "强痛点" },
  { title: "军训防晒避坑清单，先收藏再买", score: 87, tag: "收藏向" },
  { title: "海边暴晒前后护肤清单", score: 86, tag: "科普向" }
];

export const copyCandidates: CopyCandidate[] = [
  { id: "A1", style: "素人种草", summary: "从早八通勤、午休外出、下班补涂三个场景切入，适合生活感图文。", body: "早八赶地铁时最怕防晒厚重，妆面还没到公司就开始闷。这支防晒喷雾更适合放在通勤包里随手补，喷雾比较细，落在脸上不会明显挂水，也不会一层一层糊住。我的用法是早上先涂防晒霜，午休外出前用喷雾补一层，下午下班前如果还要走路，也会再补一次。" },
  { id: "A2", style: "备忘录风", summary: "用清单结构讲补涂误区、适合人群和通勤包必备理由。", body: "通勤防晒备忘录：1. 防晒不是越厚越好，关键是按场景补涂。2. 妆后补防晒不要来回揉搓，喷雾更适合快速补。3. 油皮重点看清爽、不黏腻、不闷。4. 敏感肌先做局部测试。5. 放包里的防晒要小巧、喷头细、补涂快。" },
  { id: "A3", style: "科普风", summary: "解释为什么涂了防晒仍会晒黑，再自然引出补涂和喷雾。", body: "很多人涂了防晒还是晒黑，不一定是产品没用，更多时候是用量、补涂和场景没跟上。通勤路上出汗、出油、擦汗都会影响防晒膜，午后如果完全不补，防护力就容易打折。防晒喷雾适合作为补充，不建议完全替代早上的防晒霜。" },
  { id: "A4", style: "真实分享", summary: "真实记录一周使用感，强调清爽、便携和坚持补涂。", body: "这周我把防晒喷雾放进通勤包里，使用频率比想象中高。早上出门前还是会正常涂防晒霜，喷雾主要用在午休外出、下班前补涂、临时去户外的时候。肤感比较清爽，不会明显泛白，补喷后等一会儿再戴口罩会更舒服。" },
  { id: "A5", style: "闺蜜口吻", summary: "像朋友提醒一样讲油皮补防晒容易踩的坑。", body: "姐妹，油皮夏天补防晒真的别硬叠厚涂。先吸一下浮油，再用喷雾少量多次补，等它稍微成膜再戴口罩，会比直接往脸上糊一层舒服很多。防晒霜负责早上打底，喷雾负责白天补涂，这样通勤路上会更容易坚持。" }
];

export const trafficTags = ["通勤防晒", "防晒喷雾", "油皮防晒", "夏天护肤", "不泛白", "不黏腻", "学生党防晒", "补涂防晒", "防晒推荐", "护肤好物"];

export const imagePlans: ImagePlanItem[] = [
  { page: 1, type: "封面图", use: "抓住通勤补涂痛点", title: "夏天通勤防晒喷雾", copy: "包里常备这一支", prompt: "3:4 小红书封面，通勤包、防晒喷雾、明亮干净护肤氛围，标题区域留白", negativePrompt: "夸张医学效果、暗色脏乱背景、过度磨皮", referencePath: "assets/reference/spf_commute_cover", included: true, status: "done" },
  { page: 2, type: "痛点图", use: "解释闷脸出油问题", title: "为什么越晒越暗沉", copy: "不是你懒，是补涂没跟上", prompt: "油皮女生夏天通勤出油泛红的三格对比，备忘录风", negativePrompt: "夸张晒伤、医疗诊断画面", referencePath: "assets/reference/oily_skin", included: true, status: "done" },
  { page: 3, type: "知识解释图", use: "降低硬广感", title: "防晒不是越厚越好", copy: "关键是按场景补涂", prompt: "简洁科普卡片，防晒膜、出汗、擦汗示意，橙色重点标注", negativePrompt: "复杂公式、药品包装", referencePath: "assets/reference/spf_knowledge", included: true, status: "generating" },
  { page: 4, type: "产品图", use: "展示产品便携性", title: "通勤包友好尺寸", copy: "小包也放得下", prompt: "防晒喷雾放入通勤包侧袋，桌面明亮，生活感拍摄", negativePrompt: "品牌侵权 logo、夸张广告字", referencePath: "assets/product/sunscreen_spray", included: true, status: "pending" },
  { page: 5, type: "质地图", use: "展示清爽肤感", title: "不黏腻的补喷体验", copy: "喷完等 30 秒再戴口罩", prompt: "手背喷雾细雾质地、清爽成膜、小红书真实测评风", negativePrompt: "油腻反光、过度液滴", referencePath: "assets/product/texture", included: true, status: "pending" },
  { page: 6, type: "卖点图", use: "归纳适合人群", title: "适合这些场景", copy: "办公室、午休、地铁通勤", prompt: "三场景拼贴，办公室、地铁口、午休外出，干净橙色标注", negativePrompt: "拥挤混乱、低清晰度", referencePath: "assets/ugc/commute", included: true, status: "pending" },
  { page: 7, type: "场景图", use: "增强真实使用感", title: "午休外出前补一层", copy: "30 秒完成通勤补防晒", prompt: "办公室镜前补喷防晒，真实自然，轻生活方式图文", negativePrompt: "过度摆拍、厚重妆容", referencePath: "assets/ugc/office_reapply", included: true, status: "pending" },
  { page: 8, type: "总结收藏图", use: "提升收藏", title: "通勤防晒备忘录", copy: "先收藏，明天照着做", prompt: "备忘录清单风，早上打底、中午补喷、下午再补三步骤", negativePrompt: "文字拥挤、难阅读", referencePath: "assets/reference/checklist", included: true, status: "pending" },
  { page: 9, type: "评论引导图", use: "引导互动", title: "你是哪种防晒困难户", copy: "评论区说说你的肤质", prompt: "小红书互动结尾页，油皮、敏感肌、带妆补涂三个选项", negativePrompt: "攻击性表达、医疗承诺", referencePath: "assets/reference/comment_prompt", included: true, status: "pending" }
];

export const videoScriptRows: VideoScriptRow[] = [
  { id: "s1", time: "00:00-00:03", scene: "女生走出地铁口，阳光很强", action: "抬手遮阳并看向镜头", audio: "城市环境声", voiceover: "夏天通勤，防晒真的不能只靠早上那一次。", selected: true },
  { id: "s2", time: "00:04-00:08", scene: "镜头切到包里的防晒喷雾", action: "从包侧袋拿出产品", audio: "轻快节奏", voiceover: "我现在会把这支喷雾放包里，午休外出前补一层。", selected: true },
  { id: "s3", time: "00:09-00:14", scene: "办公室镜前补喷", action: "先按压吸油纸，再少量多次喷", audio: "喷雾声", voiceover: "带妆补喷不要来回揉，先吸浮油，再离远一点喷。", selected: true },
  { id: "s4", time: "00:15-00:20", scene: "手背展示喷雾颗粒和成膜", action: "轻拍手背等待成膜", audio: "轻敲桌面", voiceover: "肤感比较清爽，不会一层一层糊在脸上。", selected: false },
  { id: "s5", time: "00:21-00:26", scene: "下班走出办公楼", action: "补喷后放回包里", audio: "环境声渐开", voiceover: "防晒霜打底，喷雾补涂，通勤防晒会更容易坚持。", selected: false },
  { id: "s6", time: "00:27-00:30", scene: "备忘录总结页", action: "手指点到评论区问题", audio: "提示音", voiceover: "你是油皮还是敏感肌补涂困难户？", selected: false }
];

export const videoShots: VideoShotPlan[] = [
  { id: "v1", selected: true, no: 1, title: "开场引入", scene: "地铁口强光与通勤人群", voiceFocus: "防晒不能只靠早上一次", prompt: "9:16 短视频，夏日地铁口强光，女生自然看镜头抬手，真实生活感", negativePrompt: "夸张晒伤、低清晰度、过度美颜", referencePath: "assets/video/commute_intro", duration: "3s", status: "done" },
  { id: "v2", selected: true, no: 2, title: "痛点展示", scene: "出油、泛红、口罩闷脸三连画面", voiceFocus: "出汗擦汗影响防晒膜", prompt: "油皮夏天通勤痛点三连画面，轻微出油，真实护肤短视频", negativePrompt: "医疗症状、夸张红肿", referencePath: "assets/video/oily_skin_pain", duration: "5s", status: "done" },
  { id: "v3", selected: true, no: 3, title: "产品展示", scene: "从通勤包拿出防晒喷雾", voiceFocus: "喷雾适合妆后补涂", prompt: "通勤包内拿出防晒喷雾，干净桌面，产品展示自然", negativePrompt: "侵权品牌 logo、夸张广告牌", referencePath: "assets/product/sunscreen_spray", duration: "4s", status: "generating" },
  { id: "v4", selected: false, no: 4, title: "卖点讲解", scene: "喷头、手背、成膜细节", voiceFocus: "清爽细雾，少量多次", prompt: "喷头特写、手背细雾、成膜过程，护肤测评质感", negativePrompt: "油腻厚重、文字过大", referencePath: "assets/video/texture_demo", duration: "6s", status: "pending" },
  { id: "v5", selected: false, no: 5, title: "使用场景", scene: "办公室镜前和午休外出前", voiceFocus: "先吸油，再补喷，等成膜", prompt: "办公室镜前补防晒，午休外出前准备，真实明亮", negativePrompt: "拥挤背景、强烈暗色", referencePath: "assets/ugc/office_reapply", duration: "5s", status: "pending" },
  { id: "v6", selected: false, no: 6, title: "总结引导", scene: "备忘录卡片与评论区问题", voiceFocus: "引导评论肤质和补涂困难", prompt: "短视频结尾互动卡片，油皮、敏感肌、带妆补涂选项", negativePrompt: "攻击性语言、虚假承诺", referencePath: "assets/reference/comment_prompt", duration: "4s", status: "pending" }
];

export const videoExtraction = {
  title: "夏天通勤补防晒，喷雾到底怎么用才不花妆",
  coverCopy: "油皮通勤防晒补涂备忘录",
  sellingPoints: ["妆后补喷更方便", "清爽不黏腻", "适合通勤包常备", "防晒霜打底 + 喷雾补涂"],
  structure: ["痛点开场", "补涂误区", "产品展示", "场景演示", "总结引导"],
  voiceover: "夏天出门防晒真的不能偷懒，尤其是通勤路上，太阳一晒脸真的很容易闷、泛红、出油。今天这支我放包里随手补，质地比较清爽，不会一层一层糊在脸上。我的习惯是早上先用防晒霜打底，中午外出前再用喷雾补一层，下午下班前如果还要走一段路，也会再补一次。"
};

export const detectionStats = [
  { label: "待查看", value: "38", tone: "review" },
  { label: "推荐保留", value: "96", tone: "approved" },
  { label: "需优化", value: "21", tone: "warning" },
  { label: "已淘汰", value: "14", tone: "rejected" }
] as const;

export const detectionItems = [
  { id: "d1", preview: "防晒喷雾", title: "夏天通勤防晒喷雾，包里常备这一支", summary: "通勤场景下的防晒补涂图文", sourcePlatform: "小红书", targetPlatform: "小红书", type: "长图文", quality: 92, duplicate: "12%", compliance: "通过", generatedAt: "07-08 16:20", status: "approved" },
  { id: "d2", preview: "敏感肌", title: "敏感肌防晒不要乱选", summary: "防晒避坑与成分表达弱化建议", sourcePlatform: "小红书", targetPlatform: "小红书", type: "短图文", quality: 84, duplicate: "18%", compliance: "需优化", generatedAt: "07-08 15:10", status: "warning" },
  { id: "d3", preview: "补涂口播", title: "小红书防晒补涂 20 秒口播脚本", summary: "小红书短视频口播脚本和分镜提示词", sourcePlatform: "小红书", targetPlatform: "小红书", type: "短视频", quality: 89, duplicate: "9%", compliance: "通过", generatedAt: "07-08 11:26", status: "approved" },
  { id: "d4", preview: "军训清单", title: "军训防晒避坑清单", summary: "部分功效表达过强，需要改写", sourcePlatform: "小红书", targetPlatform: "小红书", type: "图文", quality: 71, duplicate: "31%", compliance: "需优化", generatedAt: "07-08 10:15", status: "warning" },
  { id: "d5", preview: "海边护肤", title: "海边暴晒前后护肤清单", summary: "与历史素材重复度偏高", sourcePlatform: "小红书", targetPlatform: "小红书", type: "清单图文", quality: 62, duplicate: "46%", compliance: "已淘汰", generatedAt: "07-07 19:05", status: "rejected" }
] as const;

export const analyticsSummary = [
  { label: "发布内容数", value: "186", trend: "+24" },
  { label: "总曝光量", value: "128.6w", trend: "+18.4%" },
  { label: "总浏览量", value: "72.4w", trend: "+12.8%" },
  { label: "总点赞", value: "8.9w", trend: "+16.2%" },
  { label: "总评论", value: "1.2w", trend: "+9.6%" },
  { label: "总分享", value: "6,430", trend: "+7.1%" },
  { label: "互动率", value: "8.7%", trend: "+1.4%" }
] as const;

export const accountPerformance = [
  { platform: "小红书", badge: "RED", name: "白桃养肤记", handle: "xhs_01_baitao_yangfuji", posts: 42, views: "18.6w", likes: "2.8w", comments: "3,208", shares: "1,024", rate: "9.6%", status: "active", tag: "最佳互动率" },
  { platform: "小红书", badge: "RED", name: "叙妍欧尼吖", handle: "xhs_02_xuyan_ouniya", posts: 38, views: "15.2w", likes: "2.1w", comments: "2,870", shares: "824", rate: "8.8%", status: "active", tag: "增长最快" },
  { platform: "小红书", badge: "RED", name: "村头在逃公主", handle: "xhs_03_cuntou_princess", posts: 31, views: "11.7w", likes: "1.5w", comments: "1,936", shares: "642", rate: "8.1%", status: "active", tag: "素人感稳定" },
  { platform: "小红书", badge: "RED", name: "小英家的牛", handle: "xhs_04_xiaoying_niu", posts: 24, views: "9.4w", likes: "1.2w", comments: "1,012", shares: "508", rate: "7.9%", status: "active", tag: "待优化" }
] as const;

export const trendData = [
  { day: "07-02", exposure: 82000, views: 42000, likes: 5400 },
  { day: "07-03", exposure: 94000, views: 51000, likes: 6100 },
  { day: "07-04", exposure: 87000, views: 47000, likes: 5800 },
  { day: "07-05", exposure: 112000, views: 65000, likes: 7900 },
  { day: "07-06", exposure: 126000, views: 72000, likes: 8600 },
  { day: "07-07", exposure: 138000, views: 81000, likes: 9300 },
  { day: "07-08", exposure: 156000, views: 93000, likes: 10800 }
] as const;

export const publishBars = [
  { day: "07-02", image: 16, video: 6 },
  { day: "07-03", image: 18, video: 8 },
  { day: "07-04", image: 15, video: 7 },
  { day: "07-05", image: 24, video: 9 },
  { day: "07-06", image: 22, video: 11 },
  { day: "07-07", image: 26, video: 10 },
  { day: "07-08", image: 31, video: 12 }
] as const;

export const typePie = [
  { name: "长图文", value: 44 },
  { name: "短图文", value: 26 },
  { name: "短视频", value: 21 },
  { name: "口播脚本", value: 9 }
] as const;

export const topTopics = ["通勤防晒", "敏感肌避坑", "防晒喷雾补涂", "油皮不闷痘", "军训防晒", "晒后护理", "不泛白防晒", "海边暴晒", "备忘录护肤", "包内好物"];

export const topContent = [
  { title: "为什么涂了防晒还是会晒黑", platform: "小红书", score: "9.6", views: "8.4w" },
  { title: "油皮补防晒 30 秒流程", platform: "小红书", score: "9.2", views: "7.9w" },
  { title: "敏感肌防晒不要乱选", platform: "小红书", score: "8.9", views: "6.6w" },
  { title: "早八出门快速补防晒流程", platform: "小红书", score: "8.7", views: "5.8w" },
  { title: "军训防晒避坑清单", platform: "小红书", score: "8.4", views: "5.1w" },
  { title: "夏天防晒包里到底放什么", platform: "小红书", score: "8.1", views: "4.4w" },
  { title: "通勤包友好防晒喷雾", platform: "小红书", score: "7.9", views: "4.1w" },
  { title: "带妆补防晒不要揉搓", platform: "小红书", score: "7.8", views: "3.9w" },
  { title: "海边暴晒前后护肤清单", platform: "小红书", score: "7.6", views: "3.5w" },
  { title: "通勤防晒常见误区", platform: "小红书", score: "7.4", views: "3.1w" }
] as const;

export const accountPlatformOverview = [
  { platform: "小红书", badge: "RED", total: 4, active: 3, target: 30, completed: 22, progress: 73 }
] as const;

export const templateItems = [
  { id: "tpl1", name: "九图防晒备忘录", platform: "小红书", type: "长图文", used: 128, cover: "9 图清单", tone: "收藏向", categoryId: "image", category: "图文", target: "image" },
  { id: "tpl2", name: "素人种草标题组", platform: "小红书", type: "标题组", used: 96, cover: "标题库", tone: "素人感", categoryId: "image", category: "图文", target: "image" },
  { id: "tpl3", name: "短视频口播脚本", platform: "小红书", type: "短视频", used: 74, cover: "口播", tone: "真实分享", categoryId: "video", category: "视频", target: "video" },
  { id: "tpl4", name: "敏感肌避坑模板", platform: "小红书", type: "轻知识", used: 63, cover: "避坑", tone: "理性提醒", categoryId: "seeding", category: "种草", target: "image" },
  { id: "tpl5", name: "补涂流程分镜", platform: "小红书", type: "分镜脚本", used: 51, cover: "分镜", tone: "流程感", categoryId: "video", category: "视频", target: "video" },
  { id: "tpl6", name: "合规功效弱化模板", platform: "小红书", type: "改写模板", used: 48, cover: "合规", tone: "安全表达", categoryId: "compliance", category: "合规", target: "image" }
] as const;
