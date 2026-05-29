# OOpii API 接口文档

本文档用于帮助开发者直接调用 OOpii 服务器 API。接口整体兼容 OpenAI 风格，同时扩展了图片异步任务与视频任务接口。

## 基础信息

**Base URL**

```text
https://www.oopii.cc
```

**鉴权**

所有接口都需要传入 API Key：

```http
Authorization: Bearer OOPII_API_KEY
```

图片异步任务的查询和取图接口建议同时带上 `X-API-Key`，以兼容不同客户端：

```http
Authorization: Bearer OOPII_API_KEY
X-API-Key: OOPII_API_KEY
```

**通用响应错误格式**

```json
{
  "error": {
    "code": "",
    "message": "Invalid token",
    "type": "new_api_error"
  }
}
```

常见 HTTP 状态：

| 状态码 | 含义 | 处理建议 |
| --- | --- | --- |
| `401` | API Key 无效或未传 | 检查 `Authorization` |
| `403` | 模型或账号权限不足 | 检查账号权限、模型是否开放 |
| `429` | 请求过快或上游限流 | 延迟重试 |
| `500/502/503/504` | 上游繁忙、维护或超时 | 建议重试或切换模型 |

## 推荐模型

| 场景 | 模型 ID | 推荐接口 |
| --- | --- | --- |
| 文本/剧本生成 | `all-5.4` | `/v1/chat/completions` |
| 文本/剧本生成 | `all-5.5` | `/v1/chat/completions` |
| 图片生成/图片编辑 | `all-image-2` | `/v1/images/generations`、`/v1/images/edits` |
| 图片生成/图片编辑 | `monkey-image-pro` | Gemini `generateContent` |
| 图片生成/图片编辑 | `monkey-image-flash 2` | Gemini `generateContent` |
| 视频生成 | `OK-video` | `/api/v1/videos` |

说明：`grok-imagine-image-lite` 在软件中有兼容入口，但当前不作为主推荐模型；请优先使用上表模型。

## OOpii 软件内置调用对应关系

OOpii 无限画布内置的 OOpii 提供商会自动选择接口路线。开发者自己接入服务器 API 时，可以按下表直接调用：

| 软件中的功能/模型 | 服务器模型 ID | 实际接口 |
| --- | --- | --- |
| 剧本/文案：`all-5.4` | `all-5.4` | `POST /v1/chat/completions` |
| 剧本/文案：`all-5.5` | `all-5.5` | `POST /v1/chat/completions` |
| 分镜图片：`all-image-2` | `all-image-2` | 无参考图：`POST /v1/images/generations`；有参考图：`POST /v1/images/edits` |
| 分镜图片：`monkey-pro` | `monkey-image-pro` | `POST /v1beta/models/monkey-image-pro:generateContent` |
| 分镜图片：`monkey-2` | `monkey-image-flash 2` | `POST /v1beta/models/monkey-image-flash%202:generateContent` |
| OOpii 视频：`OK-video` | `OK-video` | `POST /api/v1/videos` |

软件内置图片生成默认使用异步任务模式。用户自行调用时也建议使用 `?async=true`，这样长耗时图片任务不会因为 HTTP 超时丢失结果。

## 查询模型列表

```bash
curl https://www.oopii.cc/v1/models \
  -H "Authorization: Bearer OOPII_API_KEY"
```

## 文本生成

### `POST /v1/chat/completions`

适用于 `all-5.4`、`all-5.5`。

**请求示例**

```bash
curl https://www.oopii.cc/v1/chat/completions \
  -H "Authorization: Bearer OOPII_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "all-5.4",
    "messages": [
      {
        "role": "user",
        "content": "请写一个 30 秒短视频分镜脚本，主题是春日咖啡馆。"
      }
    ],
    "stream": false
  }'
```

**响应示例**

```json
{
  "id": "chatcmpl_xxx",
  "object": "chat.completion",
  "created": 1779950000,
  "model": "all-5.4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "镜头 1：..."
      },
      "finish_reason": "stop"
    }
  ]
}
```

## all-image-2 图片生成

`all-image-2` 使用 OpenAI Images 风格接口。无参考图走 `/v1/images/generations`，有参考图走 `/v1/images/edits`。

### 支持的比例和尺寸

| 分辨率 | 支持比例 | 实际尺寸 |
| --- | --- | --- |
| `1K` | `1:1` | `1024x1024` |
| `1K` | `16:9` / `9:16` | `1280x720` / `720x1280` |
| `1K` | `4:3` / `3:4` | `1152x864` / `864x1152` |
| `1K` | `3:2` / `2:3` | `1248x832` / `832x1248` |
| `1K` | `4:5` / `5:4` | `896x1120` / `1120x896` |
| `1K` | `21:9` / `9:21` | `1456x624` / `624x1456` |
| `2K` | `1:1` | `2048x2048` |
| `2K` | `16:9` / `9:16` | `2560x1440` / `1440x2560` |
| `2K` | `4:3` / `3:4` | `2304x1728` / `1728x2304` |
| `2K` | `3:2` / `2:3` | `2496x1664` / `1664x2496` |
| `2K` | `4:5` / `5:4` | `1792x2240` / `2240x1792` |
| `2K` | `21:9` / `9:21` | `3024x1296` / `1296x3024` |
| `4K` | `1:1` | `2880x2880` |
| `4K` | `16:9` / `9:16` | `3840x2160` / `2160x3840` |
| `4K` | `4:3` / `3:4` | `3264x2448` / `2448x3264` |
| `4K` | `3:2` / `2:3` | `3504x2336` / `2336x3504` |
| `4K` | `4:5` / `5:4` | `2560x3200` / `3200x2560` |
| `4K` | `21:9` / `9:21` | `3696x1584` / `1584x3696` |

`quality` 可选：`low`、`medium`、`high`。推荐默认 `medium`。

### 同步生成图片

```bash
curl https://www.oopii.cc/v1/images/generations \
  -H "Authorization: Bearer OOPII_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "all-image-2",
    "prompt": "一张春日咖啡馆海报，温暖阳光，手绘插画风格",
    "n": 1,
    "size": "2048x2048",
    "aspect_ratio": "1:1",
    "quality": "medium",
    "image_backend": "auto"
  }'
```

**响应示例**

```json
{
  "created": 1779950000,
  "data": [
    {
      "url": "https://www.oopii.cc/xxx/result.png",
      "b64_json": "",
      "revised_prompt": "..."
    }
  ]
}
```

### 异步生成图片

图片生成耗时较长时推荐使用异步模式。在接口 URL 后追加 `?async=true`。

```bash
curl "https://www.oopii.cc/v1/images/generations?async=true" \
  -H "Authorization: Bearer OOPII_API_KEY" \
  -H "X-API-Key: OOPII_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "all-image-2",
    "prompt": "8 个春日主题游戏道具图标，1:1，精致手绘风格",
    "n": 1,
    "size": "2048x2048",
    "aspect_ratio": "1:1",
    "quality": "medium",
    "image_backend": "auto"
  }'
```

**提交响应示例**

```json
{
  "task_id": "task_xxxxxxxxxxxxxxxxxxxxx",
  "status": "queued",
  "status_url": "https://www.oopii.cc/v1/images/tasks/task_xxxxxxxxxxxxxxxxxxxxx",
  "content_url": "https://www.oopii.cc/v1/images/tasks/task_xxxxxxxxxxxxxxxxxxxxx/content",
  "expires_at": 1779960000
}
```

### 查询异步图片任务

```bash
curl https://www.oopii.cc/v1/images/tasks/task_xxxxxxxxxxxxxxxxxxxxx \
  -H "Authorization: Bearer OOPII_API_KEY" \
  -H "X-API-Key: OOPII_API_KEY" \
  -H "Accept: application/json"
```

**处理中响应**

```json
{
  "task_id": "task_xxxxxxxxxxxxxxxxxxxxx",
  "status": "processing",
  "progress": "35%",
  "status_url": "https://www.oopii.cc/v1/images/tasks/task_xxxxxxxxxxxxxxxxxxxxx",
  "content_url": "https://www.oopii.cc/v1/images/tasks/task_xxxxxxxxxxxxxxxxxxxxx/content",
  "expires_at": 1779960000
}
```

**成功响应**

```json
{
  "task_id": "task_xxxxxxxxxxxxxxxxxxxxx",
  "status": "succeeded",
  "progress": "100%",
  "data": [
    {
      "url": "https://www.oopii.cc/v1/images/tasks/task_xxxxxxxxxxxxxxxxxxxxx/content",
      "b64_json": "",
      "revised_prompt": "..."
    }
  ],
  "content_url": "https://www.oopii.cc/v1/images/tasks/task_xxxxxxxxxxxxxxxxxxxxx/content",
  "expires_at": 1779960000
}
```

状态值说明：

| 状态 | 含义 |
| --- | --- |
| `submitted` / `queued` | 已提交，等待处理 |
| `processing` / `running` / `in_progress` | 生成中 |
| `succeeded` / `success` / `completed` | 成功 |
| `failed` / `failure` / `error` | 失败 |
| `expired` | 任务或资源已过期 |

建议轮询间隔：`3-5` 秒。不要高频轮询。

### 下载异步图片结果

异步图片结果地址需要鉴权，不能直接裸链访问。

```bash
curl https://www.oopii.cc/v1/images/tasks/task_xxxxxxxxxxxxxxxxxxxxx/content \
  -H "Authorization: Bearer OOPII_API_KEY" \
  -H "X-API-Key: OOPII_API_KEY" \
  -H "Accept: image/*, application/octet-stream" \
  --output result.png
```

注意：异步图片结果是短期缓存资源，请在成功后尽快下载并转存到自己的存储。

## all-image-2 图片编辑

有参考图时使用 `/v1/images/edits`，请求格式为 `multipart/form-data`。

### 同步图片编辑

```bash
curl https://www.oopii.cc/v1/images/edits \
  -H "Authorization: Bearer OOPII_API_KEY" \
  -F "model=all-image-2" \
  -F "prompt=参考图片风格，生成一组春日主题道具图标，保持干净背景" \
  -F "n=1" \
  -F "size=2048x2048" \
  -F "aspect_ratio=1:1" \
  -F "quality=medium" \
  -F "image_backend=auto" \
  -F "image=@reference.png"
```

多张参考图重复传 `image` 字段：

```bash
curl https://www.oopii.cc/v1/images/edits \
  -H "Authorization: Bearer OOPII_API_KEY" \
  -F "model=all-image-2" \
  -F "prompt=融合这些参考图，生成统一风格的产品海报" \
  -F "n=1" \
  -F "size=2560x1440" \
  -F "aspect_ratio=16:9" \
  -F "quality=medium" \
  -F "image=@ref-1.png" \
  -F "image=@ref-2.png"
```

### 异步图片编辑

```bash
curl "https://www.oopii.cc/v1/images/edits?async=true" \
  -H "Authorization: Bearer OOPII_API_KEY" \
  -H "X-API-Key: OOPII_API_KEY" \
  -F "model=all-image-2" \
  -F "prompt=保持参考图主体，换成春日咖啡馆场景，1:1" \
  -F "n=1" \
  -F "size=2048x2048" \
  -F "aspect_ratio=1:1" \
  -F "quality=medium" \
  -F "image_backend=auto" \
  -F "image=@reference.png"
```

后续查询和下载方式同“异步生成图片”。

## monkey 图片模型

`monkey-image-pro` 与 `monkey-image-flash 2` 推荐使用 Gemini `generateContent` 风格接口。

### Endpoint

```text
POST /v1beta/models/{model}:generateContent
```

可用模型：

```text
monkey-image-pro
monkey-image-flash 2
```

URL 中的模型名如果包含空格，需要 URL 编码。`monkey-image-flash 2` 可写成：

```text
monkey-image-flash%202
```

### 文生图

```bash
curl "https://www.oopii.cc/v1beta/models/monkey-image-pro:generateContent" \
  -H "Authorization: Bearer OOPII_API_KEY" \
  -H "X-API-Key: OOPII_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [
          {
            "text": "生成一张 16:9 的春日咖啡馆宣传图，干净构图，高级插画风"
          }
        ]
      }
    ],
    "generationConfig": {
      "responseModalities": ["IMAGE"],
      "imageConfig": {
        "aspectRatio": "16:9",
        "imageSize": "2K"
      }
    }
  }'
```

### 图生图/参考图

参考图使用 `inlineData`，图片内容为 base64，不要带 `data:image/png;base64,` 前缀。

```bash
curl "https://www.oopii.cc/v1beta/models/monkey-image-pro:generateContent" \
  -H "Authorization: Bearer OOPII_API_KEY" \
  -H "X-API-Key: OOPII_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [
          {
            "text": "参考这张图的风格，生成一张 1:1 的春季道具集合图"
          },
          {
            "inlineData": {
              "mimeType": "image/png",
              "data": "BASE64_IMAGE_DATA"
            }
          }
        ]
      }
    ],
    "generationConfig": {
      "responseModalities": ["IMAGE"],
      "imageConfig": {
        "aspectRatio": "1:1",
        "imageSize": "2K"
      }
    }
  }'
```

**响应示例**

```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "inlineData": {
              "mimeType": "image/png",
              "data": "BASE64_IMAGE_RESULT"
            }
          }
        ]
      }
    }
  ]
}
```

### monkey 异步模式

如果需要异步，URL 后追加 `?async=true`：

```bash
curl "https://www.oopii.cc/v1beta/models/monkey-image-pro:generateContent?async=true" \
  -H "Authorization: Bearer OOPII_API_KEY" \
  -H "X-API-Key: OOPII_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [
          {
            "text": "生成一张 1:1 的春日道具图标集合"
          }
        ]
      }
    ],
    "generationConfig": {
      "responseModalities": ["IMAGE"],
      "imageConfig": {
        "aspectRatio": "1:1",
        "imageSize": "2K"
      }
    }
  }'
```

提交响应、任务查询、结果下载与 `all-image-2` 异步图片一致：

```text
GET /v1/images/tasks/{task_id}
GET /v1/images/tasks/{task_id}/content
```

## 视频生成

视频接口用于 `OK-video`。

### `POST /api/v1/videos`

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 固定推荐 `OK-video` |
| `prompt` | string | 是 | 视频提示词 |
| `seconds` | number | 是 | 支持 `6` 或 `10` |
| `size` | string | 是 | 支持 `1280x720`、`720x1280`、`1024x1024`、`1792x1024`、`1024x1792` |
| `image` | string/object | 否 | 首帧或单张参考图，可传 URL 或 `{ "url": "..." }` |
| `reference_images` | array | 否 | 多参考图，最多 7 张 |

**提交任务**

```bash
curl https://www.oopii.cc/api/v1/videos \
  -H "Authorization: Bearer OOPII_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "OK-video",
    "prompt": "春日咖啡馆外景，阳光洒落，镜头缓慢推进，温暖治愈",
    "seconds": 6,
    "size": "1280x720"
  }'
```

**带参考图**

```bash
curl https://www.oopii.cc/api/v1/videos \
  -H "Authorization: Bearer OOPII_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "OK-video",
    "prompt": "让参考图中的角色在春日街道中自然转身，镜头轻微推进",
    "seconds": 6,
    "size": "720x1280",
    "reference_images": [
      { "url": "https://example.com/ref-1.png" }
    ]
  }'
```

**提交响应**

```json
{
  "task_id": "task_xxxxxxxxxxxxxxxxxxxxx"
}
```

### 查询视频任务

```bash
curl https://www.oopii.cc/api/v1/videos/task_xxxxxxxxxxxxxxxxxxxxx \
  -H "Authorization: Bearer OOPII_API_KEY" \
  -H "Accept: application/json"
```

**响应示例**

```json
{
  "task_id": "task_xxxxxxxxxxxxxxxxxxxxx",
  "status": "running",
  "model": "OK-video",
  "cover_url": null,
  "output_url": null,
  "size": "1280x720",
  "seconds": 6,
  "error_message": null,
  "created_at": 1779950000,
  "updated_at": 1779950060
}
```

成功后通常会返回 `output_url`。如果需要直接下载二进制结果，也可以调用 content 接口。

### 下载视频结果

```bash
curl https://www.oopii.cc/api/v1/videos/task_xxxxxxxxxxxxxxxxxxxxx/content \
  -H "Authorization: Bearer OOPII_API_KEY" \
  -H "Accept: video/mp4,application/octet-stream,*/*" \
  --output result.mp4
```

## 计费和失败处理

- 同步接口失败时，错误日志通常不产生消费额度。
- 异步任务成功后会结算额度。
- 异步任务失败时会走返还记录，用户侧应以最终任务状态为准。
- 客户端不要只看提交成功；异步任务必须轮询到 `succeeded` 后再下载结果。
- `content_url` 需要鉴权访问。浏览器直接打开裸链可能返回 `401 Invalid token`。

## 推荐客户端流程

图片异步推荐流程：

1. 调用 `/v1/images/generations?async=true` 或 `/v1/images/edits?async=true`。
2. 保存返回的 `task_id`。
3. 每 `3-5` 秒调用 `/v1/images/tasks/{task_id}`。
4. 如果状态是处理中，继续轮询。
5. 如果状态是成功，调用 `/v1/images/tasks/{task_id}/content` 下载图片。
6. 如果状态是失败或过期，提示用户失败原因，不要继续下载。

视频推荐流程：

1. 调用 `POST /api/v1/videos`。
2. 保存返回的 `task_id`。
3. 每 `5-10` 秒调用 `GET /api/v1/videos/{task_id}`。
4. 成功后读取 `output_url` 或调用 `/content` 下载。

## 最小 Node.js 示例：异步图片

```js
const API_KEY = process.env.OOPII_API_KEY;
const BASE_URL = "https://www.oopii.cc";

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "X-API-Key": API_KEY,
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function main() {
  const submit = await requestJson(`${BASE_URL}/v1/images/generations?async=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "all-image-2",
      prompt: "一张 1:1 春日咖啡馆插画",
      n: 1,
      size: "2048x2048",
      aspect_ratio: "1:1",
      quality: "medium",
      image_backend: "auto",
    }),
  });

  const taskId = submit.task_id;
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const task = await requestJson(`${BASE_URL}/v1/images/tasks/${taskId}`);
    const status = String(task.status || "").toLowerCase();

    if (["succeeded", "success", "completed"].includes(status)) {
      const imageResponse = await fetch(`${BASE_URL}/v1/images/tasks/${taskId}/content`, {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "X-API-Key": API_KEY,
          Accept: "image/*, application/octet-stream",
        },
      });
      if (!imageResponse.ok) {
        throw new Error(`download failed: ${imageResponse.status} ${await imageResponse.text()}`);
      }
      const buffer = Buffer.from(await imageResponse.arrayBuffer());
      await require("node:fs/promises").writeFile("result.png", buffer);
      console.log("saved result.png");
      break;
    }

    if (["failed", "failure", "error", "expired"].includes(status)) {
      throw new Error(task.error?.message || task.error || `task ${status}`);
    }

    console.log(`task ${taskId}: ${status || "unknown"}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```
