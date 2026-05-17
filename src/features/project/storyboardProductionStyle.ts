export const STORYBOARD_PRODUCTION_SKETCH_STYLE_TEMPLATE_ID =
  'builtin-storyboard-production-sketch';

export const STORYBOARD_PRODUCTION_STYLE_CATEGORY_ID =
  'builtin-storyboard-production-style';

export const STORYBOARD_PRODUCTION_STYLE_CATEGORY_NAME =
  '系统推荐';

export const STORYBOARD_PRODUCTION_SKETCH_STYLE_TEMPLATE_NAME =
  '分镜拍摄草图';

export const DEFAULT_STORYBOARD_PRODUCTION_SKETCH_STYLE_PROMPT = [
  '生成一张完整的电影拍摄分镜板设计稿，画面是白底纸张/制片文档版式，横向 16:9，可读的 STORYBOARD 分镜板页面。优先保留完整分镜板结构，而不是只输出缺少信息的单一画面。',
  '页面结构参考专业导演分镜板：顶部标题栏写 STORYBOARD / 分镜板，并包含场次、地点、总时长；主体按镜头顺序排列 3 到 5 个连续镜头条目，每个条目左侧是电影写实画面格，画面格左上角有黑底白字镜头号和时间段；中间是“机位/站位图”，使用俯视平面简图、圆点人物、摄影机图标、视线方向箭头、移动路径和动作序号；右侧是表格信息区，字段包含主体、动作、描述、镜头、台词、音效。',
  '页面底部必须包含 SCENE LAYOUT / 场景平面图（俯视图）和 LIGHTING & MOOD / 光影与氛围说明，展示整体站位、人物移动路线、摄影机位置、灯光方向、色彩板和风格说明。',
  '视觉风格：专业影视前期分镜板、拍摄方案页、导演预演图；可以根据项目风格使用写实、动漫、漫画或概念设计视觉，但整体页面必须清晰锐利、版式整齐、边框表格明确、文字标签尽量清楚可读。',
  '必须表现镜头构图、人物站位、空间关系、动作调度、机位方向、运动路线、光影氛围和叙事信息。允许并鼓励出现中文表格标签、镜头编号、时间段、箭头、图例和简化示意符号。',
  '请避免丢失分镜板页面结构，避免无信息的模糊草图、不可读乱码文字、水印和 UI 截图感；重点让镜头条目、机位图、场景平面图和光影说明都清楚可辨。',
].join('\n');
