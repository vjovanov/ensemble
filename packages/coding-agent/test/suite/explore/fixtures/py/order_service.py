class OrderService:
    """Service that processes orders against inventory."""

    def __init__(self, tax_rate: float) -> None:
        self.tax_rate = tax_rate
        self.pending = 0

    def compute_total(self, amount: float) -> float:
        """Compute the total for an order including tax."""
        return amount + amount * self.tax_rate

    def reset(self) -> None:
        self.pending = 0
