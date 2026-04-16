use std::sync::Arc;

use super::AIProvider;

pub mod alibaba;
pub mod azemm;
pub mod bltcy;
pub mod coding;
pub mod comfly;
pub mod compatible;
pub mod fal;
pub mod grsai;
pub mod kie;
pub mod newapi;
pub mod ppio;
pub mod runninghub;
pub mod volcengine;
pub mod zhenzhen;

pub use alibaba::AlibabaProvider;
pub use azemm::AzemmProvider;
pub use bltcy::BltcyProvider;
pub use coding::CodingProvider;
pub use comfly::ComflyProvider;
pub use compatible::CompatibleProvider;
pub use fal::FalProvider;
pub use grsai::GrsaiProvider;
pub use kie::KieProvider;
pub use newapi::NewApiProvider;
pub use ppio::PPIOProvider;
pub use runninghub::RunningHubProvider;
pub use volcengine::VolcengineProvider;
pub use zhenzhen::ZhenzhenProvider;

pub fn build_default_providers() -> Vec<Arc<dyn AIProvider>> {
    vec![
        Arc::new(PPIOProvider::new()),
        Arc::new(GrsaiProvider::new()),
        Arc::new(KieProvider::new()),
        Arc::new(FalProvider::new()),
        Arc::new(AlibabaProvider::new()),
        Arc::new(AzemmProvider::new()),
        Arc::new(BltcyProvider::new()),
        Arc::new(CompatibleProvider::new()),
        Arc::new(CodingProvider::new()),
        Arc::new(NewApiProvider::new()),
        Arc::new(ZhenzhenProvider::new()),
        Arc::new(ComflyProvider::new()),
        Arc::new(VolcengineProvider::new()),
        Arc::new(RunningHubProvider::new()),
    ]
}
