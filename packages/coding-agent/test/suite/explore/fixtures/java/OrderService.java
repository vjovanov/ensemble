/** Service that processes orders against inventory. */
public class OrderService {
	private final double taxRate;
	private int pending;

	public OrderService(double taxRate) {
		this.taxRate = taxRate;
		this.pending = 0;
	}

	/** Compute the total for an order including tax. */
	public double computeTotal(double amount) {
		return amount + amount * this.taxRate;
	}

	public void reset() {
		this.pending = 0;
	}
}
