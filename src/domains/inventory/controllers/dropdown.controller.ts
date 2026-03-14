/**
 * Inventory Dropdown Controller — v1
 *
 * Lightweight, read-only endpoints optimised for UI dropdown/select components,
 * dispense workflows, and dashboard stock-status widgets.
 *
 * ┌─ Versioning ─────────────────────────────────────────────────────────────┐
 * │  version: 'v1'  → resolves at  /api/v1/inventory/dropdowns              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1/inventory/dropdowns):
 *   GET  /medications              — medication dropdown list
 *   GET  /consumables              — consumable dropdown list
 *   GET  /dispense/medications     — medications with batch detail for dispense
 *   GET  /dispense/consumables     — consumables with batch detail for dispense
 *   GET  /combined                 — medications + consumables in one response
 *   GET  /search                   — cross-type search
 *   GET  /low-stock                — items below minimum stock level
 *   GET  /out-of-stock             — items with zero available stock
 *   GET  /prescription-medications — prescription-only medications
 *   GET  /controlled-substances    — controlled substance medications
 *   GET  /sterile-consumables      — sterile consumables
 *   GET  /categories               — category dropdown with item counts
 *   GET  /summary                  — inventory KPI summary
 *   GET  /category/:categoryId     — items filtered to a specific category
 *   GET  /expiring                 — items whose batches expire soon
 *   GET  /needing-reorder          — low-stock + out-of-stock combined
 *   GET  /active-counts            — active item counts by type
 *   GET  /stock-status             — stock status overview
 */

import {
  Controller,
  Get,
  Query,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
  HttpStatus,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { Request } from 'express';

// ── Guards ────────────────────────────────────────────────────────────────────
import { WorkspaceJwtGuard } from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }        from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }  from '../../../common/security/auth/permissions.guard';

// ── Auth decorators ───────────────────────────────────────────────────────────
import { Roles } from '../../../common/security/auth/decorators';

// ── RBAC ─────────────────────────────────────────────────────────────────────
import { UserRole, ItemType } from '../../../common/enums';

// ── Service ───────────────────────────────────────────────────────────────────
import { InventoryDropdownService } from '../services/dropdown.service';

// ── DTOs ──────────────────────────────────────────────────────────────────────
import {
  DropdownFilterDto,
  DispenseFilterDto,
  SearchInventoryDto,
} from '../dtos/dropdown/dropdown-filter.dto';
import {
  DropdownItemDto,
  DropdownDispenseItemDto,
  InventoryDropdownResponseDto,
  LowStockResponseDto,
  CategoryDropdownDto,
  InventorySummaryDto,
} from '../dtos/dropdown/dropdown-response.dto';

// ─── Role shorthand ───────────────────────────────────────────────────────────

const VIEWER_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.BILLING_STAFF,
  UserRole.PHARMACIST,
  UserRole.THERAPIST,
];

@ApiTags('Inventory — Dropdowns')
@ApiBearerAuth()
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@Roles(...VIEWER_ROLES)
@Controller({ path: 'inventory/dropdowns', version: 'v1' })
export class InventoryDropdownController {
  constructor(private readonly dropdownService: InventoryDropdownService) {}

  // ── Medication dropdowns ───────────────────────────────────────────────────

  @Get('medications')
  @ApiOperation({ summary: 'Get medications for dropdown selection' })
  @ApiResponse({ status: HttpStatus.OK, type: [DropdownItemDto] })
  async getMedicationsForDropdown(
    @Query() filterDto: DropdownFilterDto,
    @Req() req: Request,
  ): Promise<DropdownItemDto[]> {
    return this.dropdownService.getMedicationsForDropdown(filterDto, (req as any).workspaceId);
  }

  @Get('dispense/medications')
  @ApiOperation({ summary: 'Get medications with batch details for dispense' })
  @ApiResponse({ status: HttpStatus.OK, type: [DropdownDispenseItemDto] })
  async getMedicationsForDispense(
    @Query() filterDto: DispenseFilterDto,
    @Req() req: Request,
  ): Promise<DropdownDispenseItemDto[]> {
    return this.dropdownService.getMedicationsForDispense(filterDto, (req as any).workspaceId);
  }

  @Get('prescription-medications')
  @ApiOperation({ summary: 'Get prescription-only medications' })
  @ApiResponse({ status: HttpStatus.OK, type: [DropdownItemDto] })
  async getPrescriptionMedications(
    @Query() filterDto: DropdownFilterDto,
    @Req() req: Request,
  ): Promise<DropdownItemDto[]> {
    return this.dropdownService.getPrescriptionMedications(filterDto, (req as any).workspaceId);
  }

  @Get('controlled-substances')
  @ApiOperation({ summary: 'Get controlled substance medications' })
  @ApiResponse({ status: HttpStatus.OK, type: [DropdownItemDto] })
  async getControlledSubstances(
    @Query() filterDto: DropdownFilterDto,
    @Req() req: Request,
  ): Promise<DropdownItemDto[]> {
    return this.dropdownService.getControlledSubstances(filterDto, (req as any).workspaceId);
  }

  // ── Consumable dropdowns ───────────────────────────────────────────────────

  @Get('consumables')
  @ApiOperation({ summary: 'Get consumables for dropdown selection' })
  @ApiResponse({ status: HttpStatus.OK, type: [DropdownItemDto] })
  async getConsumablesForDropdown(
    @Query() filterDto: DropdownFilterDto,
    @Req() req: Request,
  ): Promise<DropdownItemDto[]> {
    return this.dropdownService.getConsumablesForDropdown(filterDto, (req as any).workspaceId);
  }

  @Get('dispense/consumables')
  @ApiOperation({ summary: 'Get consumables with batch details for dispense' })
  @ApiResponse({ status: HttpStatus.OK, type: [DropdownDispenseItemDto] })
  async getConsumablesForDispense(
    @Query() filterDto: DispenseFilterDto,
    @Req() req: Request,
  ): Promise<DropdownDispenseItemDto[]> {
    return this.dropdownService.getConsumablesForDispense(filterDto, (req as any).workspaceId);
  }

  @Get('sterile-consumables')
  @ApiOperation({ summary: 'Get sterile consumables only' })
  @ApiResponse({ status: HttpStatus.OK, type: [DropdownItemDto] })
  async getSterileConsumables(
    @Query() filterDto: DropdownFilterDto,
    @Req() req: Request,
  ): Promise<DropdownItemDto[]> {
    return this.dropdownService.getSterileConsumables(filterDto, (req as any).workspaceId);
  }

  // ── Combined ───────────────────────────────────────────────────────────────

  @Get('combined')
  @ApiOperation({ summary: 'Get medications and consumables in a single response' })
  @ApiResponse({ status: HttpStatus.OK, type: InventoryDropdownResponseDto })
  async getCombinedInventory(
    @Query() filterDto: DropdownFilterDto,
    @Req() req: Request,
  ): Promise<InventoryDropdownResponseDto> {
    return this.dropdownService.getCombinedInventory(filterDto, (req as any).workspaceId);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search across all inventory items' })
  @ApiResponse({ status: HttpStatus.OK, type: InventoryDropdownResponseDto })
  async searchInventory(
    @Query() searchDto: SearchInventoryDto,
    @Req() req: Request,
  ): Promise<InventoryDropdownResponseDto> {
    return this.dropdownService.searchInventory(searchDto, (req as any).workspaceId);
  }

  // ── Stock alerts ───────────────────────────────────────────────────────────

  @Get('low-stock')
  @ApiOperation({ summary: 'Get items below minimum stock level' })
  @ApiResponse({ status: HttpStatus.OK, type: LowStockResponseDto })
  async getLowStockItems(@Req() req: Request): Promise<LowStockResponseDto> {
    return this.dropdownService.getLowStockItems((req as any).workspaceId);
  }

  @Get('out-of-stock')
  @ApiOperation({ summary: 'Get items with zero available stock' })
  @ApiResponse({ status: HttpStatus.OK, type: LowStockResponseDto })
  async getOutOfStockItems(@Req() req: Request): Promise<LowStockResponseDto> {
    return this.dropdownService.getOutOfStockItems((req as any).workspaceId);
  }

  @Get('needing-reorder')
  @ApiOperation({ summary: 'Get both low-stock and out-of-stock items for reordering' })
  @ApiResponse({ status: HttpStatus.OK })
  async getItemsNeedingReorder(
    @Req() req: Request,
  ): Promise<{ lowStock: LowStockResponseDto; outOfStock: LowStockResponseDto }> {
    return this.dropdownService.getItemsNeedingReorder((req as any).workspaceId);
  }

  // ── Categories ─────────────────────────────────────────────────────────────

  @Get('categories')
  @ApiOperation({ summary: 'Get categories for dropdown with item counts' })
  @ApiResponse({ status: HttpStatus.OK, type: [CategoryDropdownDto] })
  @ApiQuery({ name: 'type', required: false, enum: ItemType })
  async getCategories(
    @Query('type') type: ItemType | undefined,
    @Req() req: Request,
  ): Promise<CategoryDropdownDto[]> {
    return this.dropdownService.getCategories((req as any).workspaceId, type);
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  @Get('summary')
  @ApiOperation({ summary: 'Get inventory KPI summary for dashboard' })
  @ApiResponse({ status: HttpStatus.OK, type: InventorySummaryDto })
  async getInventorySummary(@Req() req: Request): Promise<InventorySummaryDto> {
    return this.dropdownService.getInventorySummary((req as any).workspaceId);
  }

  // ── Category items ─────────────────────────────────────────────────────────

  @Get('category/:categoryId')
  @ApiOperation({ summary: 'Get all items belonging to a specific category' })
  @ApiResponse({ status: HttpStatus.OK, type: InventoryDropdownResponseDto })
  @ApiParam({ name: 'categoryId', type: String })
  async getItemsByCategory(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Query() filterDto: DropdownFilterDto,
    @Req() req: Request,
  ): Promise<InventoryDropdownResponseDto> {
    return this.dropdownService.getItemsByCategory(categoryId, filterDto, (req as any).workspaceId);
  }

  // ── Expiring ───────────────────────────────────────────────────────────────

  @Get('expiring')
  @ApiOperation({ summary: 'Get items with batches expiring within N days' })
  @ApiResponse({ status: HttpStatus.OK, type: InventoryDropdownResponseDto })
  @ApiQuery({ name: 'days', required: false, type: Number, description: 'Days threshold (default 30)' })
  async getExpiringItems(
    @Query('days', new DefaultValuePipe(30), new ParseIntPipe()) days: number,
    @Req() req: Request,
  ): Promise<InventoryDropdownResponseDto> {
    return this.dropdownService.getExpiringItems(days, (req as any).workspaceId);
  }

  // ── Composite utility endpoints ────────────────────────────────────────────

  @Get('active-counts')
  @ApiOperation({ summary: 'Get active item counts by type' })
  @ApiResponse({ status: HttpStatus.OK })
  async getActiveItemCounts(
    @Req() req: Request,
  ): Promise<{ activeMedications: number; activeConsumables: number; totalActive: number }> {
    const workspaceId = (req as any).workspaceId as string;
    const [medications, consumables] = await Promise.all([
      this.dropdownService.getMedicationsForDropdown({ isActive: true, limit: 1000 }, workspaceId),
      this.dropdownService.getConsumablesForDropdown({ isActive: true, limit: 1000 }, workspaceId),
    ]);
    return {
      activeMedications: medications.length,
      activeConsumables: consumables.length,
      totalActive:       medications.length + consumables.length,
    };
  }

  @Get('stock-status')
  @ApiOperation({ summary: 'Get stock status overview across all inventory' })
  @ApiResponse({ status: HttpStatus.OK })
  async getStockStatusOverview(
    @Req() req: Request,
  ): Promise<{
    totalItems: number;
    inStock: number;
    lowStock: number;
    outOfStock: number;
    stockValue: number;
  }> {
    const workspaceId = (req as any).workspaceId as string;
    const [allItems, lowStock, outOfStock, summary] = await Promise.all([
      this.dropdownService.getCombinedInventory({}, workspaceId),
      this.dropdownService.getLowStockItems(workspaceId),
      this.dropdownService.getOutOfStockItems(workspaceId),
      this.dropdownService.getInventorySummary(workspaceId),
    ]);

    const inStock = allItems.totalCount - (lowStock.totalCount + outOfStock.totalCount);

    return {
      totalItems: allItems.totalCount,
      inStock:    Math.max(0, inStock),
      lowStock:   lowStock.totalCount,
      outOfStock: outOfStock.totalCount,
      stockValue: summary.totalStockValue,
    };
  }
}
