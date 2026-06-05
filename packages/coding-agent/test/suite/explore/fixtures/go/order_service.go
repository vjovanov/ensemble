package orders

// OrderService processes orders against inventory.
type OrderService struct {
	taxRate float64
	pending int
}

// ComputeTotal returns the total for an order including tax.
func (s *OrderService) ComputeTotal(amount float64) float64 {
	return amount + amount*s.taxRate
}

func (s *OrderService) Reset() {
	s.pending = 0
}
