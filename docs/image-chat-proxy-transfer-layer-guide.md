# 图片 Chat 转接层搭建说明书

## 1. 适用场景

这个转接层用于解决“客户端或 NewAPI 发出的是 OpenAI Chat Completions 格式，但上游图片服务实际需要 Images Generations / Images Edits 格式”的兼容问题。

典型用途：

- 把 `/v1/chat/completions` 里的图片生成/编辑请求转换为 `/v1/images/generations` 或 `/v1/images/edits`。
- 兼容带参考图的请求，把 chat message 里的 `image_url` 提取成 multipart 文件上传。
- 统一处理 `size`、`image_size`、`aspect_ratio` 等参数，避免上游比例不对。
- 把上游返回的图片 URL 或 base64 图片转成可公开访问的本地图片 URL。
- 给 NewAPI 某个渠道做兜底代理，不直接改原渠道。

## 2. 总体架构

```text
客户端 / NewAPI
    |
    | OpenAI 兼容请求
    v
图片 Chat 转接层 FastAPI
    |
    | 转换后的 OpenAI Images 请求
    v
上游图片 API
    |
    | 图片 URL / b64_json
    v
转接层本地缓存 generated/
    |
    | https://your-domain/proxy-images/xxx.png
    v
客户端 / NewAPI
```

推荐单独部署为一个 Docker 容器，监听内网端口，例如 `8787`。NewAPI 渠道的代理地址或 API 地址指向这个服务。

## 3. 接口设计

建议支持这些路由：

```text
GET  /health
POST /v1/chat/completions
POST /chat/completions
POST /v1/images/generations
POST /images/generations
POST /v1/images/edits
POST /images/edits
GET  /proxy-images/{filename}
```

`/health` 用于健康检查。

`/v1/chat/completions` 是核心转接入口：

- 没有参考图：转成上游 `/v1/images/generations`。
- 有参考图：转成上游 `/v1/images/edits`。
- 上游返回图片后，包装回 Chat Completions 风格响应。

`/v1/images/generations` 和 `/v1/images/edits` 可以作为透传入口，只做参数修正和错误透传。

## 4. 请求转换规则

### 4.1 Chat 转图片生成

当 chat 请求里只有文本 prompt，没有图片引用时：

```json
{
  "model": "gpt-image-2-4k-CL",
  "messages": [
    {
      "role": "user",
      "content": "生成一张春天主题海报"
    }
  ],
  "size": "2160x3840"
}
```

转接为：

```json
{
  "model": "gpt-image-2-4k-CL",
  "prompt": "生成一张春天主题海报",
  "size": "2160x3840",
  "response_format": "url"
}
```

然后请求上游：

```text
POST {UPSTREAM_BASE_URL}/v1/images/generations
```

### 4.2 Chat 转图片编辑

当 chat 请求里包含 `image_url` 时：

```json
{
  "model": "gpt-image-2-2k-CL",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "参考这张图重新绘制"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "https://example.com/input.png"
          }
        }
      ]
    }
  ],
  "size": "2560x1440"
}
```

转接层需要：

1. 提取文本作为 `prompt`。
2. 下载或解码 `image_url`。
3. 用 multipart/form-data 请求上游 `/v1/images/edits`。
4. 单图字段用 `image`，多图字段可用 `image[]`，具体以目标上游要求为准。

## 5. 尺寸参数处理

建议优先使用 OpenAI 兼容的 `size` 参数：

```json
{
  "size": "2160x3840"
}
```

常见映射可以这样设计：

```text
1K  1:1   -> 1024x1024
1K  16:9  -> 1280x720
1K  9:16  -> 720x1280
2K  1:1   -> 2048x2048
2K  16:9  -> 2560x1440
2K  9:16  -> 1440x2560
4K  16:9  -> 3840x2160
4K  9:16  -> 2160x3840
```

兼容顺序建议：

```text
prompt 内隐藏尺寸标记
top-level size
top-level image_size
top-level aspect_ratio
extra_body.google.image_config.image_size
extra_body.google.image_config.aspect_ratio
model 名称里的 1K / 2K / 4K
默认 1K 1:1
```

如果上游对尺寸格式比较严格，转接层应尽量把非标准字段整理成 OpenAI 兼容的 `size`，减少同一请求里同时出现多个尺寸来源导致的冲突。

## 6. 响应包装

上游可能返回：

```json
{
  "data": [
    {
      "url": "https://upstream.example.com/result.png"
    }
  ]
}
```

也可能返回：

```json
{
  "data": [
    {
      "b64_json": "..."
    }
  ]
}
```

转接层建议统一包装成 Chat Completions 响应：

```json
{
  "id": "chatcmpl-xxxx",
  "object": "chat.completion",
  "model": "gpt-image-2-4k-CL",
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "message": {
        "role": "assistant",
        "content": [
          {
            "type": "text",
            "text": "Generated image."
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://your-domain/proxy-images/xxx.png"
            }
          }
        ],
        "images": [
          {
            "url": "https://your-domain/proxy-images/xxx.png"
          }
        ],
        "image": {
          "url": "https://your-domain/proxy-images/xxx.png"
        }
      }
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 1,
    "total_tokens": 1
  },
  "data": [
    {
      "url": "https://your-domain/proxy-images/xxx.png"
    }
  ]
}
```

这样可以兼容不同客户端取图逻辑。

## 7. 错误处理

转接层不要吞掉上游错误。建议规则：

```text
上游返回 4xx / 5xx：原状态码返回，并尽量保留上游 JSON。
上游返回 HTML 错误：包装成 error.message 返回。
上游超时：返回 504。
网络连接失败：返回 502。
转接层内部异常：返回 500。
```

示例：

```json
{
  "error": {
    "message": "Proxy upstream timeout: ..."
  }
}
```

注意：如果上游返回 `413 Request Entity Too Large`，通常说明上游没有接收这次素材请求，应该把错误明确传回用户侧，方便用户调整素材。

## 8. Docker 部署示例

目录结构建议：

```text
/opt/newapi-image-chat-proxy
  app.py
  requirements.txt
  Dockerfile
  docker-compose.yml
  generated/
```

`requirements.txt`：

```text
fastapi==0.116.1
uvicorn[standard]==0.35.0
httpx==0.28.1
python-multipart==0.0.20
```

`Dockerfile`：

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./

EXPOSE 8787

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8787"]
```

`docker-compose.yml`：

```yaml
services:
  image-chat-proxy:
    build: .
    container_name: image-chat-proxy
    restart: always
    ports:
      - "8787:8787"
    volumes:
      - /opt/newapi-image-chat-proxy/generated:/app/generated
    environment:
      UPSTREAM_BASE_URL: https://upstream.example.com
      REQUEST_TIMEOUT_SECONDS: "600"
      DEFAULT_RESPONSE_FORMAT: url
      PUBLIC_BASE_URL: https://www.example.com
      GENERATED_DIR: /app/generated
      LOG_LEVEL: INFO
```

启动：

```bash
cd /opt/newapi-image-chat-proxy
docker compose up -d --build
```

检查：

```bash
docker ps --filter name=image-chat-proxy
curl http://127.0.0.1:8787/health
docker logs --tail 100 image-chat-proxy
```

## 9. Nginx 接入示例

如果只需要 NewAPI 内部访问，可以不公开 `8787`。

如果需要公开图片缓存地址，可以配置：

```nginx
location /proxy-images/ {
    proxy_pass http://127.0.0.1:8787/proxy-images/;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 60s;
    proxy_send_timeout 1000s;
    proxy_read_timeout 1000s;
}
```

如果整个域名都给转接层使用：

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 60s;
    proxy_send_timeout 1000s;
    proxy_read_timeout 1000s;
}
```

## 10. NewAPI 渠道配置建议

推荐不要直接改旧渠道，而是复制一个新渠道做兜底。

示例：

```text
原渠道 7：直连上游
新渠道 7-fallback：指向 http://127.0.0.1:8787 或 http://image-chat-proxy:8787
```

如果 NewAPI 和转接层在同一台机器：

```text
Base URL: http://127.0.0.1:8787
```

如果 NewAPI 在 Docker 网络里访问转接层：

```text
Base URL: http://image-chat-proxy:8787
```

注意 Docker 网络必须互通。

## 11. 内存与 Swap 风险

图片转接层的内存波动通常来自这些位置：

- `request.json()` 会一次性读取完整 JSON。
- base64 图片会先作为字符串存在，再解码成 bytes，内存可能接近翻倍。
- `UploadFile.read()` 会把上传文件完整读入内存。
- `response.content` 会把上游图片完整读入内存后再写盘。
- 多参考图请求会同时持有多张图片 bytes。
- 多个并发请求会把上述内存压力叠加。

如果看到 Swap 偏高，先确认是不是这个容器正在使用 Swap，而不是系统历史换出或其它进程导致。

## 12. 图片缓存清理

转接层会把上游图片保存到 `generated/`，如果不清理会持续增长。

查看占用：

```bash
du -sh /opt/newapi-image-chat-proxy/generated
find /opt/newapi-image-chat-proxy/generated -type f | wc -l
```

清理 7 天前文件：

```bash
find /opt/newapi-image-chat-proxy/generated -type f -mtime +7 -delete
```

可以加定时任务：

```cron
0 4 * * * find /opt/newapi-image-chat-proxy/generated -type f -mtime +7 -delete
```

如果业务需要长期保留图片，不要直接删除，需要改成对象存储或 CDN。

## 13. 排查命令

查看容器：

```bash
docker ps -a --filter name=image-chat-proxy
docker logs --tail 200 image-chat-proxy
```

查看端口：

```bash
ss -lntp | grep 8787
```

查看内存：

```bash
docker stats --no-stream image-chat-proxy
docker exec image-chat-proxy grep -E "VmRSS|VmSwap|VmSize|Threads" /proc/1/status
docker exec image-chat-proxy cat /sys/fs/cgroup/memory.current
docker exec image-chat-proxy cat /sys/fs/cgroup/memory.swap.current
```

查看健康状态：

```bash
curl http://127.0.0.1:8787/health
```

查看缓存：

```bash
du -sh /opt/newapi-image-chat-proxy/generated
find /opt/newapi-image-chat-proxy/generated -type f -printf "%s %p\n" | sort -nr | head
```

## 14. 常见问题

### 14.1 页面或客户端返回 413

含义：请求体或上游接收的 multipart 文件太大。

检查：

```text
Nginx 请求体设置
NewAPI 上传相关设置
上游平台返回的错误正文
素材文件大小和请求内容
```

### 14.2 返回 504

含义：上游处理时间超过转接层或 Nginx 超时时间。

检查：

```text
REQUEST_TIMEOUT_SECONDS
proxy_read_timeout
NewAPI 渠道超时
客户端超时
```

### 14.3 比例不对

优先确认请求里有没有标准 `size`：

```json
{
  "size": "2160x3840"
}
```

如果同时传了 `aspect_ratio`、`image_size`、`extra_body.google.image_config`，转接层要统一清洗，避免上游优先读取了错误字段。

### 14.4 Swap 偏高

先确认是不是这个容器在用 Swap：

```bash
docker exec image-chat-proxy grep VmSwap /proc/1/status
docker exec image-chat-proxy cat /sys/fs/cgroup/memory.swap.current
```

如果是 `0`，说明当前不是它占用 Swap，可能是系统历史换出或其它进程。

如果它确实在用 Swap，优先观察当时请求类型、素材大小、并发量和上游响应时间，再决定是否需要优化读取和落盘方式。

图片缓存目录持续增长也会增加磁盘和系统缓存压力，建议按业务保留周期做清理或迁移到对象存储。

## 15. 最小验收清单

部署完成后至少验证：

```text
/health 返回 200。
/v1/chat/completions 纯文本生成能返回图片。
/v1/chat/completions 带 1 张参考图能返回图片。
/v1/images/generations 透传正常。
/v1/images/edits 透传正常。
上游 4xx / 5xx 错误能传回用户侧。
生成图片 URL 可以通过 /proxy-images/xxx.png 访问。
大图请求失败时不会无限重试。
容器内存和 Swap 在可控范围。
```

## 16. 生产建议

生产环境建议做到：

- 单独新建兜底渠道，不直接替换原渠道。
- 给图片缓存目录加自动清理。
- 保留上游错误状态码，不把失败伪装成成功。
- 对 `413`、安全策略拒绝、参数错误这类请求减少重试。
- 图片生成链路超时保持一致，例如客户端、NewAPI、Nginx、转接层都不低于实际需要。
- 日志至少记录模型、参考图数量、最终尺寸、上游状态码。
