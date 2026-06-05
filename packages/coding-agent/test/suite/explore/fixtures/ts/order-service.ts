/** Service that processes orders against inventory. */
export class OrderService {
	private readonly taxRate: number;
	private pending: number;

	constructor(taxRate: number) {
		this.taxRate = taxRate;
		this.pending = 0;
	}

	/** Compute the total for an order including tax. */
	computeTotal(amount: number): number {
		return amount + amount * this.taxRate;
	}

	reset(): void {
		this.pending = 0;
	}
}
