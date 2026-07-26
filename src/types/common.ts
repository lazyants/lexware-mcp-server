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
