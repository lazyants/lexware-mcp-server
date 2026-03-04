import { z } from 'zod';

export const UuidSchema = z.string().uuid().describe('Resource UUID');

export const PaginationParams = {
  page: z.number().int().min(0).optional().describe('Page number (0-indexed)'),
  size: z.number().int().min(1).max(250).optional().describe('Results per page (max 250)'),
};

export const VersionParam = {
  version: z.number().int().min(0).describe('Resource version for optimistic locking'),
};

export const SortParam = {
  sort: z.string().optional().describe('Sort field and direction, e.g. "createdDate,DESC"'),
};
