export const messages = {
  dashboard: {
    emptyPublished: 'No published statements yet.',
    emptyReview: 'No statements are waiting for review.',
    loadError: 'The statement dashboard could not be loaded.',
    loading: 'Loading statements…',
    needsAttention: 'Needs attention',
    published: 'Published statements',
    review: 'Statements to review',
    title: 'Actual Budget Importer',
    transactionCount: (count: number) => `${count} transaction${count === 1 ? '' : 's'}`,
    unknownSource: 'Unnamed statement',
  },
} as const;
