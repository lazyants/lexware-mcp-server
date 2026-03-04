export interface LexwarePagedResponse<T> {
  content: T[];
  first: boolean;
  last: boolean;
  totalPages: number;
  totalElements: number;
  numberOfElements: number;
  size: number;
  number: number;
}

export interface LexwareCreationResponse {
  id: string;
  resourceUri: string;
  createdDate: string;
  updatedDate: string;
  version: number;
}

export interface LexwareIssue {
  i18nKey: string;
  source: string;
  type: string;
}

export interface LexwareLegacyError {
  IssueList: LexwareIssue[];
}

export interface LexwareStandardError {
  status: number;
  error: string;
  message: string;
  path: string;
  timestamp: string;
  traceId: string;
}
