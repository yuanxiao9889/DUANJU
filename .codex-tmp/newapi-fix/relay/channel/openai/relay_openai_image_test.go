package openai

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

func TestOpenaiHandlerWithUsageRejectsErrorPayload(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)

	info := &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeImagesEdits}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body: ioNopCloser(`{
			"error": {
				"message": "temporary upstream failure",
				"type": "server_error",
				"code": "server_error"
			}
		}`),
	}

	usage, err := OpenaiHandlerWithUsage(c, info, resp)
	if err == nil {
		t.Fatalf("OpenaiHandlerWithUsage returned nil error")
	}
	if usage != nil {
		t.Fatalf("OpenaiHandlerWithUsage returned usage = %#v, want nil", usage)
	}
	if err.StatusCode != http.StatusBadGateway {
		t.Fatalf("status code = %d, want %d", err.StatusCode, http.StatusBadGateway)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("response body = %q, want empty body on rejected payload", recorder.Body.String())
	}
}

func TestOpenaiHandlerWithUsageRejectsEmptyImageData(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)

	info := &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeImagesGenerations}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       ioNopCloser(`{"created":1700000000,"data":[],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}`),
	}

	usage, err := OpenaiHandlerWithUsage(c, info, resp)
	if err == nil {
		t.Fatalf("OpenaiHandlerWithUsage returned nil error")
	}
	if usage != nil {
		t.Fatalf("OpenaiHandlerWithUsage returned usage = %#v, want nil", usage)
	}
	if err.GetErrorCode() != types.ErrorCodeEmptyResponse {
		t.Fatalf("error code = %q, want %q", err.GetErrorCode(), types.ErrorCodeEmptyResponse)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("response body = %q, want empty body on invalid image payload", recorder.Body.String())
	}
}

func TestOpenaiHandlerWithUsageAcceptsValidImageResponse(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)

	info := &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeImagesGenerations}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body: ioNopCloser(`{
			"created":1700000000,
			"data":[{"url":"https://example.com/image.png"}],
			"usage":{"prompt_tokens":12,"completion_tokens":34,"total_tokens":46}
		}`),
	}

	usage, err := OpenaiHandlerWithUsage(c, info, resp)
	if err != nil {
		t.Fatalf("OpenaiHandlerWithUsage returned error: %v", err)
	}
	if usage == nil {
		t.Fatalf("OpenaiHandlerWithUsage returned nil usage")
	}
	if usage.PromptTokens != 12 || usage.CompletionTokens != 34 || usage.TotalTokens != 46 {
		t.Fatalf("usage = %#v, want prompt=12 completion=34 total=46", usage)
	}
	if !strings.Contains(recorder.Body.String(), `"url":"https://example.com/image.png"`) {
		t.Fatalf("response body = %q, want OpenAI image payload", recorder.Body.String())
	}
}

type nopReadCloser struct {
	*strings.Reader
}

func (n nopReadCloser) Close() error {
	return nil
}

func ioNopCloser(body string) nopReadCloser {
	return nopReadCloser{Reader: strings.NewReader(body)}
}

var _ = dto.ImageResponse{}
