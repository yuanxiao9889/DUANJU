use std::sync::Arc;

use super::AIProvider;

pub mod ppio;
pub mod grsai;
pub mod kie;
pub mod fal;
pub mod alibaba;
pub mod coding;
pub mod zhenzhen;
pub mod comfly;

pub use fal::FalProvider;
pub use grsai::GrsaiProvider;
pub use kie::KieProvider;
pub use ppio::PPIOProvider;
pub use alibaba::AlibabaProvider;
pub use coding::CodingProvider;
pub use zhenzhen::ZhenzhenProvider;
pub use comfly::ComflyProvider;

pub fn build_default_providers() -> Vec<Arc<dyn AIProvider>> {
    vec![
        Arc::new(PPIOProvider::new()),
        Arc::new(GrsaiProvider::new()),
        Arc::new(KieProvider::new()),
        Arc::new(FalProvider::new()),
        Arc::new(AlibabaProvider::new()),
        Arc::new(CodingProvider::new()),
        Arc::new(ZhenzhenProvider::new()),
        Arc::new(ComflyProvider::new()),
    ]
}
