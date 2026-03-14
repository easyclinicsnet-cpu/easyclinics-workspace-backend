import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../enums';

export const ROLES_KEY = 'roles';
export const PERMISSIONS_KEY = 'permissions';

/**
 * Restricts a route to users with at least one of the specified roles.
 *
 * @example
 * \@Roles(UserRole.DOCTOR, UserRole.NURSE)
 * \@Get('vitals')
 * getVitals() {}
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Restricts a route to users who have ALL of the specified permission strings.
 * Permission strings follow the format "resource:action" (e.g. "patients:write").
 *
 * @example
 * \@Permissions('patients:read', 'patients:write')
 * \@Post()
 * createPatient() {}
 */
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
