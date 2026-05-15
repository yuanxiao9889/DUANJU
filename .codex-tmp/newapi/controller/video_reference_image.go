package controller

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const maxVideoReferenceImageBytes = 8 << 20

func videoReferenceImageDir() string {
	if dir := strings.TrimSpace(os.Getenv("VIDEO_REFERENCE_IMAGE_DIR")); dir != "" {
		return dir
	}
	return "/data/video-reference-images"
}

func videoReferenceImageError(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{
		"error": gin.H{
			"message": message,
			"type":    "invalid_request_error",
		},
	})
}

func randomVideoReferenceImageName(ext string) (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]) + ext, nil
}

func normalizeVideoReferenceContentType(contentType string, payload []byte) (string, string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	if normalized == "" || normalized == "application/octet-stream" {
		normalized = strings.ToLower(http.DetectContentType(payload))
	}

	switch normalized {
	case "image/jpeg", "image/jpg":
		return "image/jpeg", ".jpg", true
	case "image/png":
		return "image/png", ".png", true
	case "image/webp":
		return "image/webp", ".webp", true
	default:
		return normalized, "", false
	}
}

func publicRequestBaseURL(c *gin.Context) string {
	proto := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto"))
	if proto == "" {
		proto = strings.TrimSpace(c.GetHeader("X-Real-Scheme"))
	}
	if proto == "" {
		if c.Request.TLS != nil {
			proto = "https"
		} else {
			host := strings.ToLower(c.Request.Host)
			if strings.HasPrefix(host, "localhost") || strings.HasPrefix(host, "127.0.0.1") || strings.HasPrefix(host, "[::1]") {
				proto = "http"
			} else {
				proto = "https"
			}
		}
	}
	proto = strings.TrimSpace(strings.Split(proto, ",")[0])
	if proto != "http" && proto != "https" {
		proto = "https"
	}

	host := strings.TrimSpace(c.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = c.Request.Host
	}
	host = strings.TrimSpace(strings.Split(host, ",")[0])
	if host == "" {
		host = "localhost"
	}

	return proto + "://" + host
}

func videoReferencePublicPrefix(c *gin.Context) string {
	path := c.Request.URL.Path
	if idx := strings.Index(path, "/video-reference-images"); idx >= 0 {
		return path[:idx]
	}
	return "/api/v1"
}

func writeVideoReferenceImage(c *gin.Context, payload []byte, contentType string) (string, error) {
	dateDir := time.Now().UTC().Format("20060102")
	dir := filepath.Join(videoReferenceImageDir(), dateDir)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}

	_, ext, ok := normalizeVideoReferenceContentType(contentType, payload)
	if !ok {
		return "", fmt.Errorf("unsupported image content type: %s", contentType)
	}
	name, err := randomVideoReferenceImageName(ext)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(dir, name), payload, 0644); err != nil {
		return "", err
	}

	publicPath := fmt.Sprintf("%s/video-reference-images/%s/%s", videoReferencePublicPrefix(c), dateDir, name)
	return publicRequestBaseURL(c) + publicPath, nil
}

// VideoReferenceImageUpload stores a reference image and returns a public HTTPS URL.
// Uploads require API-token auth; reads are public so upstream video providers can fetch the image.
func VideoReferenceImageUpload(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxVideoReferenceImageBytes+1024*1024)

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		file, header, err = c.Request.FormFile("image")
	}
	if err != nil {
		videoReferenceImageError(c, http.StatusBadRequest, "reference image file is required")
		return
	}
	defer file.Close()

	payload, err := io.ReadAll(io.LimitReader(file, maxVideoReferenceImageBytes+1))
	if err != nil {
		videoReferenceImageError(c, http.StatusBadRequest, "failed to read reference image")
		return
	}
	if len(payload) == 0 {
		videoReferenceImageError(c, http.StatusBadRequest, "reference image is empty")
		return
	}
	if len(payload) > maxVideoReferenceImageBytes {
		videoReferenceImageError(c, http.StatusRequestEntityTooLarge, "reference image exceeds 8MB")
		return
	}

	contentType := ""
	if header != nil {
		contentType = header.Header.Get("Content-Type")
	}
	normalizedContentType, _, ok := normalizeVideoReferenceContentType(contentType, payload)
	if !ok {
		videoReferenceImageError(c, http.StatusBadRequest, "reference image must be jpeg, png, or webp")
		return
	}

	url, err := writeVideoReferenceImage(c, payload, normalizedContentType)
	if err != nil {
		videoReferenceImageError(c, http.StatusInternalServerError, "failed to store reference image")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"url": url,
		"data": gin.H{
			"url": url,
		},
	})
}

func VideoReferenceImageServe(c *gin.Context) {
	date := c.Param("date")
	name := c.Param("filename")
	if len(date) != 8 || strings.ContainsAny(date, `/\.`) || strings.ContainsAny(name, `/\`) {
		c.Status(http.StatusNotFound)
		return
	}

	fullPath := filepath.Join(videoReferenceImageDir(), date, name)
	rel, err := filepath.Rel(videoReferenceImageDir(), fullPath)
	if err != nil || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		c.Status(http.StatusNotFound)
		return
	}

	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg":
		c.Header("Content-Type", "image/jpeg")
	case ".png":
		c.Header("Content-Type", "image/png")
	case ".webp":
		c.Header("Content-Type", "image/webp")
	default:
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "public, max-age=86400")
	c.File(fullPath)
}
