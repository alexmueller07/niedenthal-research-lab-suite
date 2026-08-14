export interface ClassificationTaskProps {
  onContinue?: (data?: ClassificationStepData) => void;
}

export interface ClassificationStepData {
  [key: string]: unknown;
}
