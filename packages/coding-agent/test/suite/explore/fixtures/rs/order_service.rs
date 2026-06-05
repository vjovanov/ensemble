/// Service that processes orders against inventory.
pub struct OrderService {
    tax_rate: f64,
    pending: u32,
}

impl OrderService {
    /// Compute the total for an order including tax.
    pub fn compute_total(&self, amount: f64) -> f64 {
        amount + amount * self.tax_rate
    }

    pub fn reset(&mut self) {
        self.pending = 0;
    }
}
