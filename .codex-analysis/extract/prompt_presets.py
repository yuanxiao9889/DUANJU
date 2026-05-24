# -*- coding: utf-8 -*-
"""
提示词预设模块 - 存储和管理Gemini图像生成的提示词预设
支持分类管理
"""

# 分类预设结构
CATEGORIZED_PRESETS = {
    "🎨 创意转换": {
        "3D手办模型": "create a 1/7 scale commercialized figure of the character in the illustration, in a realistic style and environment. Place the figure on a computer desk, using a circular transparent acrylic base without any text. On the computer screen, display the ZBrush modeling process of the figure. Next to the computer screen, place a BANDAI-style toy packaging box printed with the original artwork.",
        "Q版编织娃娃": "A close-up, professionally composed photograph showcasing a hand-crocheted yarn doll gently cradled by two hands. The doll has a rounded shape, featuring the cute chibi image of the [upload image] character, with vivid contrasting colors and rich details. The hands holding the doll are natural and gentle, with clearly visible finger postures, and natural skin texture and light/shadow transitions, conveying a warm and realistic touch. The background is slightly blurred, depicting an indoor environment with a warm wooden tabletop and natural light streaming in from a window, creating a comfortable and intimate atmosphere. The overall image conveys a sense of exquisite craftsmanship and cherished warmth.",
        "角色扭蛋胶囊": "A detailed, transparent gashapon capsule diorama, held between fingers, featuring [NAME] in their [ICONIC POSE / STYLE]. Inside: [short description of figure's look, clothing, and accessories], with background elements such as [relevant setting: stadium, stage, lecture hall, etc.]. Lighting should be dramatic and cinematic, matching their theme. The capsule has a transparent top and a colored base [choose fitting color: e.g., royal blue, gold, black, red], decorated with [motifs related to the person]. The base is labeled with [NAME or NICKNAME] in a matching font style. The design should look like a miniature collectible, with photorealistic detail and soft bokeh.",
        "角色毛绒玩具": "A soft, high-quality plush toy of [CHARACTER], with an oversized head, small body, and stubby limbs. Made of fuzzy fabric with visible stitching and embroidered facial features. The plush is shown sitting or standing against a neutral background. The expression is cute or expressive, and it wears simple clothes or iconic accessories if relevant. Lighting is soft and even, with a realistic, collectible plush look. Centered, full-body view.",
        "Funko Pop手办": "Create a detailed 3D render of a chibi Funko Pop figure, strictly based on the provided reference photo. The figure should accurately reflect the person's appearance, hairstyle, attire, and characteristic style from the photo. High detail, studio lighting, photorealistic texture, pure white background.",
        "图片转人偶玩具": "Transform the the person in the photo into an action figure, styled after [CHARACTER_NAME] from [SOURCE / CONTEXT].\nNext to the figure, display the accessories including [ITEM_1], [ITEM_2], and [ITEM_3].\nOn the top of the toy box, write \"[BOX_LABEL_TOP]\", and underneath it, \"[BOX_LABEL_BOTTOM]\".\nPlace the box in a [BACKGROUND_SETTING] environment.\nVisualize this in a highly realistic way with attention to fine details.",
        "图片转乐高": "Transform the person in the photo into the style of a LEGO minifigure packaging box, presented in an isometric perspective. Label the packaging with the title 'ZHOGUE'. Inside the box, showcase the LEGO minifigure based on the person in the photo, accompanied by their essential items (such as cosmetics, bags, or others) as LEGO accessories. Next to the box, also display the actual LEGO minifigure itself outside of the packaging, rendered in a realistic and lifelike style.",
        "图片转芭比娃娃": "Transform the person in the photo into the style of a Barbie doll packaging box, presented in an isometric perspective. Label the packaging with the title 'ZHOGUE'. Inside the box, showcase the Barbie doll version of the person from the photo, accompanied by their essential items (such as cosmetics, bags, or others) designed as stylish Barbie accessories. Next to the box, also display the actual Barbie doll itself outside of the packaging, rendered in a realistic and lifelike style, resembling official Barbie promotional renders",
        "万物变高达": "Transform the person in the photo into the style of a Gundam model kit packaging box, presented in an isometric perspective. Label the packaging with the title 'ZHOGUE'. Inside the box, showcase a Gundam-style mecha version of the person from the photo, accompanied by their essential items (such as cosmetics, bags, or others) redesigned as futuristic mecha accessories. The packaging should resemble authentic Gunpla boxes, with technical illustrations, instruction-manual style details, and sci-fi typography. Next to the box, also display the actual Gundam-style mecha figure itself outside of the packaging, rendered in a realistic and lifelike style, similar to official Bandai promotional renders.",
        "照片变娃娃": "把这张照片变成一个可爱玩偶",
        "Q版表情贴纸": "Making a playful peace sign with both hands and winking. Tearful eyes and slightly trembling lips, showing a cute crying expression. Arms wide open in a warm, enthusiastic hug pose. Lying on their side asleep, resting on a tiny pillow with a sweet smile. Pointing forward with confidence, surrounded by shining visual effects. Blowing a kiss, with heart symbols floating around. Maintain the chibi aesthetic. Exaggerated, expressive big eyes. Soft facial lines. Background: Vibrant red with star or colorful confetti elements for decoration. Leave some clean white space around each sticker. Aspect ratio: 9:16",
        "照片变插画": "为人物生成绘画过程四宫格，第一步：线稿，第二步平铺颜色，第三步：增加阴影，第四步：细化成型。不要文字",
        "任意图片变挂件挂在包包上": "把这张照片变成一个可爱挂件/亚克力材质的扁平钥匙扣/橡胶材质的扁平钥匙扣 挂在 lv 包包/图二照片的包包上",
        "吉卜力动画风格": "Redraw this photo in Ghibli style",
        "16位游戏角色": "Recreate this [Character] as a 16-bit video game character, and place the character in a level of a 2D 16-bit platform video game.",
        "游戏界面效果": "A vibrant rhythm dance game screenshot featuring the 3D animated character from the reference photo, keeping its unique style, hat, outfit, and confident dance pose. Immersive cinematic lighting with neon pink and purple glow, glossy reflective dance floor shining under spotlights, and dynamic 3D cartoon style. Rhythm game interface with immersive UI: score meter at the top, colorful music waveform animations synced to the beat, stage timer countdown, and floating combo numbers. Highly detailed, game-like atmosphere with energy bars, neon particle effects, and immersive arcade rhythm game HUD elements. Ultra-detailed, cinematic, immersive, 3D animation.",
    },
    "👤 人物编辑": {
        "面部表情控制": "Keep the person from [Image1] unchanged, but change their facial expression to [desired expression, e.g., smiling, surprised, angry]. Preserve the pose, body proportions, hairstyle, and overall appearance. Maintain realistic lighting, shadows, and photorealistic details.",
        "姿势控制": "Take the two men and place them in the exact poses of the man in green carrying the man in red. Preserve their identities, body proportions, and clothing details. Ensure the pose is natural and realistic, with consistent lighting, shadows, and perspective. Photorealistic, high-resolution result.",
        "身体重塑": "Reshape the body of the person in [Image1] into a [target body type]. Keep the face, identity, hairstyle, and clothing consistent. Ensure realistic anatomy, natural proportions, and photorealistic details.",
        "3x3网格肖像": "Turn the photo into a 3x3 grid of photo strips with different studio-style poses and expressions.",
        "iPhone随手自拍": "Please draw an extremely ordinary and unremarkable iPhone selfie, with no clear subject or sense of composition — just like a random snapshot taken casually. The photo should include slight motion blur, with uneven lighting caused by sunlight or indoor lights resulting in mild overexposure. The angle is awkward, the composition is messy, and the overall aesthetic is deliberately plain — as if it was accidentally taken while pulling the phone out of a pocket. The subjects are [Names], taken at night, next to the [Location].",
        "宝丽来风格照片": "Take a picture with a Polaroid camera. The photo should look like a normal photo, without any clear subject or props. The photo should have a slight blur a consistent light source. Such as a flash from a dark room, spread throughout the photo. Do not change the faces. Replace the background behind the two people with a white curtain.",
        "AI拥抱年轻的自己": "Take a photo taken with a Polaroid camera. The photo should look like an ordinary photograph, without an explicit subject or property. The photo should have a slight blur and a consistent light source, like a flash from a dark room, scattered throughout the photo. Don't change the face. Change the background behind those two people with white curtains. Make it look like both people in the reference picture are hugging each other.",
        "AI黑白工作室肖像": "Please generate a top-angle and close-up black and white portrait of my face, focused on the head facing forward. Use a 35mm lens look, 10.7K 4HD quality. Proud expression. Deep black shadow background - only the face, the upper chest, and the shoulder.",
        "AI电影感肖像": "Create a vertical potrait shot using the exact same face features, characterized by stark cinematic lighting and intense contrast. Captured in a slightly low, upward-facing angle that dramatized the subject's jawline and neck, the composition evokes quite dominance and sculptural elegance. The background is a deep, saturated crimson red, creating a bold visual clash with the model's luminous skin and dark wardrobe.",
        "名人/指定人物超写实生成": "画面采用中景近乎半身的构图，镜头与人物几乎平视，但透视感强烈，但因为主体微微前倾，视觉上产生一种略带俯视感的压缩效果，让观者与模特之间的距离显得亲密而直接。人物微微抬头冲向镜头，有种拽姐的感觉。闪光灯从正面偏左上方打来，制造出硬朗的高光与深重阴影——墨镜镜片上有明显高光反射，人物后方墙面出现淡淡的投影，整体呈现典型的'直闪'质感：颗粒感轻微，可见胶片风格或高感光度数码拍摄的粗粝纹理。人物面部稍稍有点过度曝光\n\n色彩基调以低饱和的中性色为主：黑色的宽肩丝绒西装外套占据画面最大面积，面料似乎是丝绒，带有细腻的绒面纹路；内搭的黑色丝绸吊带。模特下装是黑色超短裙和薄透质感的连裤袜。背景左侧堆放的墨绿色与咖色棒球帽、右侧叠放的亮蓝色夹克及黑色头盔等杂物，在柔和阴影中提供了点缀色，同时强调了拍摄的后台或休息室氛围。\n\n人物【XXX】动作及神态具有强烈的街头时尚感：她双膝交叠坐在台面边缘，双手随意撑在身侧，身体前倾，给人一种随性却掌控全场的姿态。面部表情淡漠而自信——厚涂的裸色哑光唇膏、挺拔的鼻梁和高光额头在镜片下仍然清晰；宽大的方形黑色太阳镜遮住了双眼，却因为镜框外缘锋利的斜切角度，进一步强化了'冷面'气场。发型为高束的高马尾，碎发自然散落，在硬光照射下呈现金棕色高光，增加了几分随意的性感。\n\n整体观感是一幅带有九十年代街拍影像感的时装速写：粗颗粒、直闪、低饱和配色与夸张的廓形外套共同营造出怀旧却前卫的潮流态度。右下角带有相机时间戳：2001 05 14",
        "指定人物短视频": "change the Camera anglo a high-angled selfie perspective looking down at the woman, while preserving her exact facial features, expression, and clothing, Maintain the same living room interior background with the sofa, natural lighting, and overall photographic composition and style.",
        "人群中分离指定模糊人物+高清生成": "Separate the person inside the green box and turn it into a high-definition single-person photo",
        "精准替换视频人物": "把左边第二位人物换成希斯莱杰小丑/上传照片人物",
        "动漫转真人": "Generate a highly detailed photo of a girl cosplaying this illustration, at Comiket. Exactly replicate the same pose, body posture, hand gestures, facial expression, and camera framing as in the original illustration. Keep the same angle, perspective, and composition, without any deviation",
        "高质量摄影：指定人物+高质量姿势参考": "图一人物换成图二姿势，专业摄影棚拍摄",
        "随手拍秒变专业摄影大片": "Transform the person in the photo into highly stylized ultra-realistic portrait, with sharp facial features and flawless fair skin, standing confidently against a bold green gradient background. Dramatic, cinematic lighting highlights her facial structure, evoking the look of a luxury fashion magazine cover. Editorial photography style, high-detail, 4K resolution, symmetrical composition, minimalistic background",
        "指定人物+设计实景体验/效果图": "把人物换成图二人物，沙发换成图三沙发，配色换成橙色，文字换成'Z'",
        "赛博生娃？！两张人脸生成孩子脸": "生成图中两人物所生孩子的样子，专业摄影",
        "虚拟换装": "Keep the character in [Image1] unchanged, but replace her pant with the outfit in [Image2]. Maintain the same pose, body proportions, and facial features, while applying the color, texture, and style of the pants in [Image2]. High-quality, realistic, consistent detail.",
        "AI纱丽服装": "Create A soft, sunlit portrait wearing a flowing sheer yellow saree with delicate floral embroidery. Sit gracefully against a plain wall, bathed in warm natural light with a triangular patch of sunlight casting artistic shadows. Hold a vibrant bouquet of sunflowers close to the chest, and a small white flower is tucked behind he ear. Gentle expression, loose hair strands moving slightly, and the dreamy golden glow create a serene, poetic, and romantic.",
    },
    "🛍️ 电商应用": {
        "商品广告短片": "模特拿着香水｜The model is holding a perfume",
        "产品包装贴合": "把图一贴在图二易拉罐上，并放在极简设计的布景中，专业摄影",
        "产品设计图转真实效果/渲染": "turn this illustration of a perfume into a realistic version, Frosted glass bottle with a marble cap",
        "曲面屏贴图": "把图一放在图二大屏幕上，撑满整个屏幕",
        "直接为图片中的曲面大屏生成指定的裸眼3D内容": "为大屏幕上换上裸眼 3D 猫猫",
        "把指定图片贴在大阶梯上": "把图一海报贴在图二的大阶梯上",
    },
    "🏗️ 建筑与工业设计": {
        "建筑图转模型/建模": "convert this photo into a architecture model. Behind the model, there should be a cardboard box with an image of the architecture from the photo on it. There should also be a computer, with the content on the computer screen showing the Blender modeling process of the figurine. In front of the cardboard box, place a cardstock and put the architecture model from the photo I provided on it. I hope the PVC material can be clearly presented. It would be even better if the background is indoors.",
        "工业设计手绘秒变实景效果": "turn this photo into realistic version, with light brown leather, put into a Minimalism museum",
        "工业设计套图：马克笔、水彩、分析图、渲染图": "turn this photo into 马克笔画/水彩画/diagram",
    },
    "🎭 表情动作与光影": {
        "表情准确参考": "图一人物参考/换成图二人物的表情",
        "动物拟人表情": "把图二猫咪变成图一人物那样的表情",
        "光影参考": "图一换成图二打光，专业摄影",
        "使用光影人偶做打光参考": "图一人物变成图二光影，深色为暗",
    },
    "🎨 插画与设计": {
        "图转线稿+色卡上色": "变成线稿手绘图",
        "虚实结合/跨次元：插画人物探店": "在图中加上一对情侣坐在座位上开心的喝咖啡和交谈，人物都是粗线稿可爱插画风格",
        "脸型参考/控制，秒变卡通形象": "图一人物按照图二的脸型设计为q版形象",
        "一句咒语任何风格变写实": "turn this illustration into realistic version",
        "绝美卡片设计": "按照我的图一名片设计稿的构图和质感，为我的图二人物生成卡片\n\n卡片右上角为可爱卡通形象，突出于卡片\n\nname: Nani\nOccupation：artist\nCompany：zano-banana\nTelephone：82732691",
        "多人物插画集": "把前四个人物都变成图五那样的 黑白 极简风插画，人物要可爱并保持各自特点，并为每个人物配上合适的小道具，线条要优美，头发部分像图五那样为黑色块，并在一张图里",
        "生成绘画/渲染过程四宫格": "把图一变成图二那样的四宫格，从草图逐渐到上色渲染",
    },
    "💄 美妆时尚": {
        "虚拟试妆？！化指定妆面": "为图一人物化上图二的妆，还保持图一的姿势",
        "妆面分析+优化建议": "Analyze this image. Use red pen to denote where you can improve",
    },
    "🔧 图像处理": {
        "增强图像质量": "Enhance [Image1] to improve overall quality and detail. Keep the original composition, colors, and style intact. Increase resolution, sharpness, texture clarity, and lighting realism. Output as a photorealistic, high-resolution image.",
        "更换图像背景": "Replace the background of [Image1] with [desired background description, e.g., a beach, a forest, a city skyline]. Keep the main subject (person/object) unchanged, maintaining original proportions, lighting, and details. Ensure the subject blends naturally with the new environment. Photorealistic, high-resolution, seamless integration.",
        "添加物体到图像": "Add [desired element, e.g., a tree, a lamp, a dog] to [Image1]. Place it naturally in the scene, matching the lighting, perspective, and style. Keep the original elements unchanged. Photorealistic, seamless integration.",
        "从图像移除物体": "Remove [element to remove, e.g., a person, a car, a sign] from [Image1]. Fill the background naturally to maintain the scene's continuity, lighting, and details. Keep all other elements unchanged. Photorealistic, high-resolution.",
        "改变相机角度": "Recreate the person from [Image1] in four different camera perspectives. Keep the subject's identity, body proportions, and clothing consistent across all four images. Maintain the same background environment as [Image1], with photorealistic lighting, natural shadows, and high-quality details. Generate four variations side by side: 1. Bird's-eye view (from above). 2. Rear view (from behind). 3. Side profile view. 4. Close-up portrait view.",
        "编辑图像文字": "Edit the text in [Image1]. Replace the existing text with \"[your new text]\" while keeping the background, design, and other elements unchanged. Match the font style, size, and color to look natural and consistent with the image. Photorealistic, seamless integration.",
        "基于时间的图像生成": "Generate an image of the same scene as [Image1], but showing how it looks 10 minutes later. Keep the environment and style consistent, but add natural changes over time such as light, weather, people and so on. Photorealistic, seamless continuity.",
        "物体提取": "Extract the clothing from [Image1] and present it as a clean e-commerce product photo. Remove the model's body completely. Keep the outfit in natural 3D shape, with realistic fabric folds, seams, and textures. Display the garment as if photographed on a mannequin or neatly laid flat, centered on a pure white or transparent background. High-resolution, professional lighting, suitable for online fashion catalog.",
        "改变天气效果": "Change the weather in [Image1] to [desired weather, e.g., rainy, snowy, foggy, sunny]. Keep the main subject and overall scene intact. Adjust lighting, shadows, colors, and environmental effects to match the new weather. Photorealistic, seamless integration, high-resolution.",
        "改变图像颜色": "Change the colors in [Image1] to [desired color/style, e.g., warm tones, cool blue tones, pastel colors]. Keep the main subject and composition intact. Adjust lighting, shadows, and overall color balance to match the new color scheme. Photorealistic, high-resolution, natural-looking result.",
        "图像元素替换": "Replace [target element or area] in [Image1] with [new element or reference, e.g., a different person, object, or scene]. Keep all other parts of the image unchanged. Ensure the replacement blends naturally with lighting, perspective, and overall style. Photorealistic, high-resolution, seamless integration.",
        "图像外延扩展": "Extend [Image1] beyond its original borders using outpainting. Keep the main subject and composition intact. Generate new content around the edges that matches the style, colors, lighting, and perspective of the original image. Photorealistic, high-resolution, seamless integration.",
        "图像外延(比例控制)": "Redraw the content of Figure 1 onto Figure 2, add more detailed content to Figure 1 to fit the aspect ratio of Figure 2, completely clear the content of Figure 2, and only retain the aspect ratio of Figure 2.",
        "线稿转完整图像": "Convert the line art in [Image1] into a fully colored and detailed image. Preserve all original outlines and compositions. Apply [desired style, e.g., photorealistic, anime, cartoon, digital painting] with realistic lighting, shadows, and textures. High-resolution, natural, seamless rendering.",
        "3x3照片网格姿势": "Turn the photo into a 3x3 grid of photo strips with different studio-style poses and expressions.",
        "AI室内设计": "Add a comfortable gray sofa and a wooden coffee table in the center, matching the room's contemporary style, photorealistic render.",
        "食材变菜肴": "Here are the items available: [List of items]. Based on these items, create an image of a [type of object/scene] that can be made or represented by combining them. The composition should make logical sense, considering the relationship between the items. Ensure the image is [visual style]. It should be with appropriate proportions and clear placement of each item.",
        "解剖结构插图": "Draw a bilaterally symmetrical frontal anatomical illustration of the [Character], styled similarly to an infographic. The image should show the creature's external features on both sides, with its internal anatomy partially exposed. Detailed text should flank the image, explaining the creature's biology, abilities, behavior, habitat, and the specific functions of its anatomical structures. The overall design should be clear, informative, and in the style of a scientific illustration.",
        "内部结构分解图": "Ultra-detailed exploded view of a product, metallic parts and electronic components floating in mid-air, perfectly aligned, revealing inner structure, futuristic technology aesthetic, 8K resolution, soft cinematic lighting, highly realistic.",
        "多图像融合": "Combine multiple images ([Image1], [Image2], [Image3], …) into a single cohesive image. Keep all key subjects recognizable and maintain their proportions and details. Blend the images naturally with consistent lighting, shadows, perspective, and style. Photorealistic, high-resolution, seamless integration.",
        "风格融合": "Transform this image [Image1] into the artistic style of [Image2]. Keep the main subject, composition, and details from [Image1], but apply the colors, textures, and overall aesthetic of [Image2]. High-quality, [illustration] style, consistent details.",
        "物体组合/版本对比": "把它们组合起来",
        "连续编辑+物体组合+背景设计": "图一人物背上图二 logo 的斜挎包",
        "叠加指定材质质感/效果": "为图一照片叠加上图二玻璃的效果",
    },
    "📖 故事与角色创作": {
        "一句话生成一套角色设定/故事书": "为我生成人物的角色设定（Character Design）、比例设定、三视图、表情设定、动作设定、服装设定",
    },
}

# 兼容旧版本的扁平字典（保留向后兼容性）
PRESETS = {}
for category, presets in CATEGORIZED_PRESETS.items():
    for name, prompt in presets.items():
        PRESETS[name] = prompt


def get_presets():
    """
    获取所有提示词预设（扁平结构，向后兼容）
    
    Returns:
        dict: 提示词预设字典，键为预设名称，值为预设内容
    """
    return PRESETS


def get_categorized_presets():
    """
    获取分类的提示词预设
    
    Returns:
        dict: 分类预设字典，第一层键为分类名称，第二层键为预设名称，值为预设内容
    """
    return CATEGORIZED_PRESETS


def get_categories():
    """
    获取所有分类名称
    
    Returns:
        list: 分类名称列表
    """
    return list(CATEGORIZED_PRESETS.keys())
