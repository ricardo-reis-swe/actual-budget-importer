export const messages = {
  upload: {
    chooseFile: 'Choose a PDF statement',
    chooseParser: 'Select a bank parser',
    error: 'The PDF could not be uploaded.',
    fileRequired: 'Select a PDF statement.',
    parserRequired: 'Select a bank parser.',
    submit: 'Upload statement',
    title: 'Upload a PDF statement',
  },
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
