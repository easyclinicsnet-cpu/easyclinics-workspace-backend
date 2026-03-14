/**
 * Inventory Categories Controller — v1
 *
 * Endpoints for managing inventory categories (hierarchical tree supported).
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/inventory/categories               │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security ──────────────────────────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard → RolesGuard → PermissionsGuard (applied class-level)  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1/inventory/categories):
 *   POST   /       — create category
 *   GET    /       — list (paginated, filtered)
 *   GET    /tree   — full hierarchical tree
 *   PATCH  /:id    — update category
 *   DELETE /:id    — soft-delete category
 *   GET    /:id    — get by UUID (LAST)
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';

// ── Guards ────────────────────────────────────────────────────────────────────
import { WorkspaceJwtGuard } from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }        from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }  from '../../../common/security/auth/permissions.guard';

// ── Auth decorators ───────────────────────────────────────────────────────────
import { Roles, Permissions } from '../../../common/security/auth/decorators';

// ── RBAC enums ────────────────────────────────────────────────────────────────
import { UserRole } from '../../../common/enums';

// ── Domain service ────────────────────────────────────────────────────────────
import { CategoryService } from '../services/category.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  QueryCategoryDto,
  CategoryResponseDto,
} from '../dtos';

// ── Domain interfaces ─────────────────────────────────────────────────────────
import { IPaginatedResult } from '../interfaces';

// ---------------------------------------------------------------------------
// Role shorthand groups
// ---------------------------------------------------------------------------

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

const WRITE_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.PHARMACIST,
  UserRole.MEDICAL_ASSISTANT,
];

const ADMIN_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
];

// ---------------------------------------------------------------------------

@ApiTags('Inventory — Categories')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'inventory/categories', version: 'v1' })
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  @Post()
  @Roles(...WRITE_ROLES)
  @Permissions('inventory:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'categories_create',
    summary:     'Create inventory category',
    description: 'Creates a new inventory category. Supports hierarchical parent-child relationships. workspaceId is injected from the verified JWT.',
  })
  @ApiResponse({ status: 201, description: 'Category created',      type: CategoryResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async create(
    @Body() dto: CreateCategoryDto,
    @Req()  req: Request,
  ): Promise<CategoryResponseDto> {
    return this.categoryService.create({ ...dto, workspaceId: req.workspaceId });
  }

  // ==========================================================================
  // LIST (paginated)
  // ==========================================================================

  @Get()
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'categories_findAll',
    summary:     'List inventory categories',
    description: 'Returns a paginated flat list of inventory categories scoped to the workspace.',
  })
  @ApiResponse({ status: 200, description: 'Paginated category list', type: [CategoryResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(
    @Query() query: QueryCategoryDto,
    @Req()   req:   Request,
  ): Promise<IPaginatedResult<CategoryResponseDto>> {
    return this.categoryService.findAll(req.workspaceId, query);
  }

  // ==========================================================================
  // TREE — static route declared before /:id
  // ==========================================================================

  @Get('tree')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'categories_tree',
    summary:     'Get category tree',
    description: 'Returns the complete hierarchical category tree for the workspace, with each node containing its children.',
  })
  @ApiResponse({ status: 200, description: 'Hierarchical category tree', type: [CategoryResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getTree(@Req() req: Request): Promise<CategoryResponseDto[]> {
    return this.categoryService.findTree(req.workspaceId);
  }

  // ==========================================================================
  // UPDATE / DELETE — parameterised, before GET /:id
  // ==========================================================================

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  @Permissions('inventory:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'categories_update',
    summary:     'Update inventory category',
    description: 'Applies a partial update to an existing inventory category.',
  })
  @ApiParam({ name: 'id', description: 'Category UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated category', type: CategoryResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async update(
    @Param('id', ParseUUIDPipe) id:  string,
    @Body()                     dto: UpdateCategoryDto,
    @Req()                      req: Request,
  ): Promise<CategoryResponseDto> {
    return this.categoryService.update(req.workspaceId, id, dto);
  }

  @Delete(':id')
  @Roles(...ADMIN_ROLES)
  @Permissions('inventory:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'categories_delete',
    summary:     'Soft-delete inventory category',
    description: 'Soft-deletes an inventory category. The record is retained for audit purposes.',
  })
  @ApiParam({ name: 'id', description: 'Category UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Category deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id:  string,
    @Req()                      req: Request,
  ): Promise<void> {
    return this.categoryService.softDelete(req.workspaceId, id, req.userId);
  }

  // ==========================================================================
  // GET BY ID — LAST to avoid swallowing the /tree static route
  // ==========================================================================

  @Get(':id')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'categories_findById',
    summary:     'Get category by ID',
    description: 'Returns a single inventory category by its UUID.',
  })
  @ApiParam({ name: 'id', description: 'Category UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Category',        type: CategoryResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async findById(
    @Param('id', ParseUUIDPipe) id:  string,
    @Req()                      req: Request,
  ): Promise<CategoryResponseDto> {
    return this.categoryService.findById(req.workspaceId, id);
  }
}
