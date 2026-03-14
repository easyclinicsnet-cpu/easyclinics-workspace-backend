import {
  PatientBill,
  BillItem,
  Payment,
  Discount,
  Tax,
  Receipt,
  Invoice,
  BillingTransaction,
  PricingStrategy,
  PaymentMethod,
} from '../entities';
import { BillResponseDto } from '../dto/responses/bill.dto';
import { BillItemResponseDto } from '../dto/responses/bill-item.dto';
import { PaymentResponseDto } from '../dto/responses/payment.dto';
import { DiscountResponseDto } from '../dto/responses/discount.dto';
import { TaxResponseDto } from '../dto/responses/tax.dto';
import { ReceiptResponseDto } from '../dto/responses/receipt.dto';
import { InvoiceResponseDto } from '../dto/responses/invoice.dto';
import { BillingTransactionResponseDto } from '../dto/responses/billing-transaction.dto';
import { PricingStrategyResponseDto } from '../dto/responses/pricing-strategy.dto';
import { PaymentMethodResponseDto } from '../dto/responses/payment-method.dto';

/**
 * Maps a PatientBill entity to a BillResponseDto.
 * Includes nested items, payments, discount, and tax when available.
 */
export function mapToBillResponseDto(
  bill: PatientBill,
  items: BillItem[] = [],
  payments: Payment[] = [],
  discount?: Discount,
  tax?: Tax,
): BillResponseDto {
  const dto = new BillResponseDto();

  dto.id = bill.id;
  dto.billNumber = bill.billNumber;
  dto.patientId = bill.patientId;
  dto.appointmentId = bill.appointmentId;
  dto.department = bill.department;
  dto.subtotal = Number(bill.subtotal);
  dto.discountAmount = Number(bill.discountAmount);
  dto.taxAmount = Number(bill.taxAmount);
  dto.total = Number(bill.total);
  dto.status = bill.status;
  dto.issuedAt = bill.issuedAt;
  dto.dueDate = bill.dueDate;
  dto.notes = bill.notes;
  dto.metadata = bill.metadata;
  dto.items = items.map(mapBillItem);
  dto.payments = payments.map(mapPayment);
  dto.appliedDiscount = discount ? mapDiscount(discount) : undefined;
  dto.appliedTax = tax ? mapTax(tax) : undefined;
  dto.createdAt = bill.createdAt;
  dto.updatedAt = bill.updatedAt;

  return dto;
}

/**
 * Maps a BillItem entity to a BillItemResponseDto.
 */
export function mapBillItem(item: BillItem): BillItemResponseDto {
  const dto = new BillItemResponseDto();

  dto.id = item.id;
  dto.billId = item.billId;
  dto.description = item.description;
  dto.quantity = Number(item.quantity);
  dto.unitPrice = Number(item.unitPrice);
  dto.totalPrice = Number(item.totalPrice);
  dto.department = item.department;
  dto.medicationItemId = item.medicationItemId;
  dto.consumableItemId = item.consumableItemId;
  dto.batchId = item.batchId;
  dto.actualUnitCost = item.actualUnitCost != null ? Number(item.actualUnitCost) : undefined;
  dto.hasInsuranceClaim = item.hasInsuranceClaim;
  dto.insuranceClaimStatus = item.insuranceClaimStatus;
  dto.totalClaimedAmount = Number(item.totalClaimedAmount);
  dto.totalApprovedAmount = Number(item.totalApprovedAmount);
  dto.totalDeniedAmount = Number(item.totalDeniedAmount);
  dto.metadata = item.metadata;
  dto.createdAt = item.createdAt;

  return dto;
}

/**
 * Maps a Payment entity to a PaymentResponseDto.
 * Includes nested payment method summary when the relation is loaded.
 */
export function mapPayment(payment: Payment): PaymentResponseDto {
  const dto = new PaymentResponseDto();

  dto.id = payment.id;
  dto.paymentReference = payment.paymentReference;
  dto.billId = payment.billId;
  dto.patientId = payment.patientId;
  dto.paymentMethodId = payment.paymentMethodId;
  dto.amount = Number(payment.amount);
  dto.processingFee = Number(payment.processingFee);
  dto.netAmount = Number(payment.netAmount);
  dto.status = payment.status;
  dto.transactionId = payment.transactionId;
  dto.paymentDate = payment.paymentDate;
  dto.processedAt = payment.processedAt;
  dto.refundedAt = payment.refundedAt;
  dto.failedAt = payment.failedAt;
  dto.notes = payment.notes;
  dto.failureReason = payment.failureReason;
  dto.metadata = payment.metadata;
  dto.createdAt = payment.createdAt;

  if (payment.paymentMethod) {
    dto.paymentMethodType = payment.paymentMethod.type;
    dto.paymentMethod = {
      id: payment.paymentMethod.id,
      name: payment.paymentMethod.name,
      type: payment.paymentMethod.type,
    };
  }

  return dto;
}

/**
 * Maps a Discount entity to a DiscountResponseDto.
 */
export function mapDiscount(discount: Discount): DiscountResponseDto {
  const dto = new DiscountResponseDto();

  dto.id = discount.id;
  dto.name = discount.name;
  dto.description = discount.description;
  dto.discountType = discount.discountType;
  dto.value = Number(discount.value);
  dto.isPercentage = discount.isPercentage;
  dto.maxDiscountAmount =
    discount.maxDiscountAmount != null ? Number(discount.maxDiscountAmount) : undefined;
  dto.minPurchaseAmount =
    discount.minPurchaseAmount != null ? Number(discount.minPurchaseAmount) : undefined;
  dto.validFrom = discount.validFrom;
  dto.validUntil = discount.validUntil;
  dto.applicableServices = discount.applicableServices;
  dto.applicableDepartments = discount.applicableDepartments;
  dto.usageLimit = discount.usageLimit;
  dto.usageCount = discount.usageCount;
  dto.isActive = discount.isActive;
  dto.metadata = discount.metadata;
  dto.createdAt = discount.createdAt;
  dto.updatedAt = discount.updatedAt;

  return dto;
}

/**
 * Maps a Tax entity to a TaxResponseDto.
 */
export function mapTax(tax: Tax): TaxResponseDto {
  const dto = new TaxResponseDto();

  dto.id = tax.id;
  dto.name = tax.name;
  dto.description = tax.description;
  dto.taxType = tax.taxType;
  dto.rate = Number(tax.rate);
  dto.isCompound = tax.isCompound;
  dto.applicableServices = tax.applicableServices;
  dto.applicableDepartments = tax.applicableDepartments;
  dto.effectiveFrom = tax.effectiveFrom;
  dto.effectiveUntil = tax.effectiveUntil;
  dto.isActive = tax.isActive;
  dto.metadata = tax.metadata;
  dto.createdAt = tax.createdAt;
  dto.updatedAt = tax.updatedAt;

  return dto;
}

/**
 * Maps a Receipt entity to a ReceiptResponseDto.
 */
export function mapReceipt(receipt: Receipt): ReceiptResponseDto {
  const dto = new ReceiptResponseDto();

  dto.id = receipt.id;
  dto.receiptNumber = receipt.receiptNumber;
  dto.paymentId = receipt.paymentId;
  dto.patientId = receipt.patientId;
  dto.amount = Number(receipt.amount);
  dto.paymentMethod = receipt.paymentMethod;
  dto.issuedAt = receipt.issuedAt;
  dto.issuedBy = receipt.issuedBy;
  dto.notes = receipt.notes;
  dto.metadata = receipt.metadata;
  dto.createdAt = receipt.createdAt;

  return dto;
}

/**
 * Maps an Invoice entity to an InvoiceResponseDto.
 */
export function mapInvoice(invoice: Invoice): InvoiceResponseDto {
  const dto = new InvoiceResponseDto();

  dto.id = invoice.id;
  dto.invoiceNumber = invoice.invoiceNumber;
  dto.billId = invoice.billId;
  dto.patientId = invoice.patientId;
  dto.subtotal = Number(invoice.subtotal);
  dto.discountAmount = Number(invoice.discountAmount);
  dto.taxAmount = Number(invoice.taxAmount);
  dto.total = Number(invoice.total);
  dto.amountPaid = Number(invoice.amountPaid);
  dto.amountDue = Number(invoice.amountDue);
  dto.status = invoice.status;
  dto.issuedAt = invoice.issuedAt;
  dto.dueDate = invoice.dueDate;
  dto.paidAt = invoice.paidAt;
  dto.notes = invoice.notes;
  dto.terms = invoice.terms;
  dto.metadata = invoice.metadata;
  dto.createdAt = invoice.createdAt;
  dto.updatedAt = invoice.updatedAt;

  return dto;
}

/**
 * Maps a BillingTransaction entity to a BillingTransactionResponseDto.
 */
export function mapBillingTransaction(
  txn: BillingTransaction,
): BillingTransactionResponseDto {
  const dto = new BillingTransactionResponseDto();

  dto.id = txn.id;
  dto.transactionReference = txn.transactionReference;
  dto.transactionType = txn.transactionType;
  dto.billId = txn.billId;
  dto.paymentId = txn.paymentId;
  dto.amount = Number(txn.amount);
  dto.balanceBefore = Number(txn.balanceBefore);
  dto.balanceAfter = Number(txn.balanceAfter);
  dto.status = txn.status;
  dto.transactionDate = txn.transactionDate;
  dto.processedBy = txn.processedBy;
  dto.description = txn.description;
  dto.notes = txn.notes;
  dto.metadata = txn.metadata;
  dto.createdAt = txn.createdAt;

  return dto;
}

/**
 * Maps a PricingStrategy entity to a PricingStrategyResponseDto.
 */
export function mapPricingStrategy(strategy: PricingStrategy): PricingStrategyResponseDto {
  const dto = new PricingStrategyResponseDto();

  dto.id = strategy.id;
  dto.name = strategy.name;
  dto.description = strategy.description;
  dto.strategyType = strategy.strategyType;
  dto.serviceType = strategy.serviceType;
  dto.department = strategy.department;
  dto.basePrice = strategy.basePrice != null ? Number(strategy.basePrice) : undefined;
  dto.markupPercentage =
    strategy.markupPercentage != null ? Number(strategy.markupPercentage) : undefined;
  dto.discountPercentage =
    strategy.discountPercentage != null ? Number(strategy.discountPercentage) : undefined;
  dto.minPrice = strategy.minPrice != null ? Number(strategy.minPrice) : undefined;
  dto.maxPrice = strategy.maxPrice != null ? Number(strategy.maxPrice) : undefined;
  dto.priority = strategy.priority;
  dto.validFrom = strategy.validFrom;
  dto.validUntil = strategy.validUntil;
  dto.conditions = strategy.conditions;
  dto.pricingRules = strategy.pricingRules;
  dto.isActive = strategy.isActive;
  dto.metadata = strategy.metadata;
  dto.createdAt = strategy.createdAt;
  dto.updatedAt = strategy.updatedAt;

  return dto;
}

/**
 * Maps a PaymentMethod entity to a PaymentMethodResponseDto.
 */
export function mapPaymentMethod(method: PaymentMethod): PaymentMethodResponseDto {
  const dto = new PaymentMethodResponseDto();

  dto.id = method.id;
  dto.type = method.type;
  dto.name = method.name;
  dto.description = method.description;
  dto.processingFeePercentage =
    method.processingFeePercentage != null ? Number(method.processingFeePercentage) : undefined;
  dto.minAmount = method.minAmount != null ? Number(method.minAmount) : undefined;
  dto.maxAmount = method.maxAmount != null ? Number(method.maxAmount) : undefined;
  dto.sortOrder = method.sortOrder;
  dto.icon = method.icon;
  dto.color = method.color;
  dto.isActive = method.isActive;
  dto.configuration = method.configuration;
  dto.metadata = method.metadata;
  dto.createdAt = method.createdAt;

  return dto;
}
