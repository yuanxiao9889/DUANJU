package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

func registerOpenAIVideoRoutes(router *gin.Engine, prefix string) {
	// Public temporary reference-image URLs. Uploads are authenticated; reads are public
	// because upstream video providers need to fetch the image by URL.
	videoReferencePublicRouter := router.Group(prefix)
	videoReferencePublicRouter.Use(middleware.RouteTag("relay"))
	{
		videoReferencePublicRouter.GET("/video-reference-images/:date/:filename", controller.VideoReferenceImageServe)
		videoReferencePublicRouter.HEAD("/video-reference-images/:date/:filename", controller.VideoReferenceImageServe)
	}

	videoReferenceUploadRouter := router.Group(prefix)
	videoReferenceUploadRouter.Use(middleware.RouteTag("relay"))
	videoReferenceUploadRouter.Use(middleware.TokenAuth())
	{
		videoReferenceUploadRouter.POST("/video-reference-images", controller.VideoReferenceImageUpload)
	}

	// Video proxy: accepts either session auth (dashboard) or token auth (API clients)
	videoProxyRouter := router.Group(prefix)
	videoProxyRouter.Use(middleware.RouteTag("relay"))
	videoProxyRouter.Use(middleware.TokenOrUserAuth())
	{
		videoProxyRouter.GET("/videos/:task_id/content", controller.VideoProxy)
	}

	videoV1Router := router.Group(prefix)
	videoV1Router.Use(middleware.RouteTag("relay"))
	videoV1Router.Use(middleware.TokenAuth(), middleware.Distribute())
	{
		videoV1Router.POST("/video/generations", controller.RelayTask)
		videoV1Router.GET("/video/generations/:task_id", controller.RelayTaskFetch)
		videoV1Router.POST("/videos/:video_id/remix", controller.RelayTask)
	}
	// openai compatible API video routes
	// docs: https://platform.openai.com/docs/api-reference/videos/create
	{
		videoV1Router.POST("/videos", controller.RelayTask)
		videoV1Router.GET("/videos/:task_id", controller.RelayTaskFetch)
	}
}

func SetVideoRouter(router *gin.Engine) {
	registerOpenAIVideoRoutes(router, "/v1")
	// AetherAI / OOpii docs use /api/v1 while NewAPI historically exposed /v1.
	// Keep both entrypoints so clients can use either base URL shape.
	registerOpenAIVideoRoutes(router, "/api/v1")

	klingV1Router := router.Group("/kling/v1")
	klingV1Router.Use(middleware.RouteTag("relay"))
	klingV1Router.Use(middleware.KlingRequestConvert(), middleware.TokenAuth(), middleware.Distribute())
	{
		klingV1Router.POST("/videos/text2video", controller.RelayTask)
		klingV1Router.POST("/videos/image2video", controller.RelayTask)
		klingV1Router.GET("/videos/text2video/:task_id", controller.RelayTaskFetch)
		klingV1Router.GET("/videos/image2video/:task_id", controller.RelayTaskFetch)
	}

	// Jimeng official API routes - direct mapping to official API format
	jimengOfficialGroup := router.Group("jimeng")
	jimengOfficialGroup.Use(middleware.RouteTag("relay"))
	jimengOfficialGroup.Use(middleware.JimengRequestConvert(), middleware.TokenAuth(), middleware.Distribute())
	{
		// Maps to: /?Action=CVSync2AsyncSubmitTask&Version=2022-08-31 and /?Action=CVSync2AsyncGetResult&Version=2022-08-31
		jimengOfficialGroup.POST("/", controller.RelayTask)
	}
}
