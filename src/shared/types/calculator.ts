export type CalculatorType =
  | 'services'
  | 'goods'
  | 'delivery'
  | 'repair'
  | 'construction'
  | 'custom';

export type FieldType =
  | 'input'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'result'
  | 'html'
  | 'text'
  | 'slider'
  | 'radio'
  | 'image'
  | 'button'
  | 'booking';
export type FieldLayout = 'full' | 'half';
export type FieldOptionLayout = 'vertical' | 'horizontal';
export type TextBlockStyle = 'title' | 'subtitle' | 'description' | 'hint';
export type ImageBlockSize = 'small' | 'medium' | 'large' | 'full';
export type ImageBlockFit = 'cover' | 'contain';
export type ButtonActionType = 'calculate' | 'submit' | 'reset' | 'link' | 'vk' | 'copy';
export type ButtonColor = 'accent' | 'dark' | 'light';
export type ButtonSize = 'small' | 'medium' | 'large';
export type ButtonWidth = 'auto' | 'full';
export const MAX_BUTTON_TEXT_LENGTH = 32;
export type InputFieldSubtype =
  | 'text'
  | 'number'
  | 'phone'
  | 'email'
  | 'date'
  | 'time'
  | 'textarea'
  | 'file';

export type FormulaMode = 'simple' | 'custom';
export type ResultFieldFormat = 'plain' | 'space';
export type ResultDisplayMode = 'auto' | 'after_button';
export type CalculatorPublicationStatus = 'draft' | 'published' | 'hidden' | 'archived';

export type CalculatorOptionValue = string | number;

export interface CalculatorRequestFormSettings {
  enabled: boolean;
  title: string;
  description: string;
  nameLabel: string;
  namePlaceholder: string;
  phoneLabel: string;
  phonePlaceholder: string;
  commentLabel: string;
  commentPlaceholder: string;
  submitButtonText: string;
}

export interface CalculatorFieldOption {
  id: string;
  label: string;
  value: CalculatorOptionValue;
  description?: string;
  image?: string;
}

export interface CalculatorField {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  inputSubtype?: InputFieldSubtype;
  layout?: FieldLayout;
  required: boolean;
  unitPrice: number;
  coefficient: number;
  description?: string;
  placeholder?: string;
  hint?: string;
  htmlContent?: string;
  content?: string;
  hidden?: boolean;
  visibilityCondition?: string;
  textStyle?: TextBlockStyle;
  fontSize?: number;
  fontWeight?: number;
  textColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  linkUrl?: string;
  imageUrl?: string;
  imageAlt?: string;
  imageCaption?: string;
  imageSize?: ImageBlockSize;
  imageRadius?: number;
  imageAlign?: 'left' | 'center' | 'right';
  imageFit?: ImageBlockFit;
  buttonText?: string;
  buttonAction?: ButtonActionType;
  buttonColor?: ButtonColor;
  buttonSize?: ButtonSize;
  buttonWidth?: ButtonWidth;
  buttonRadius?: number;
  buttonLoading?: boolean;
  buttonShowWhenValid?: boolean;
  buttonUrl?: string;
  defaultValue?: string | number | boolean;
  checkboxLabel?: string;
  onValue?: CalculatorOptionValue;
  offValue?: CalculatorOptionValue;
  showPriceInline?: boolean;
  showOptionPrices?: boolean;
  showOptionDetails?: boolean;
  showOptionDescription?: boolean;
  showOptionPrice?: boolean;
  useValueInFormula?: boolean;
  options?: CalculatorFieldOption[];
  optionLayout?: FieldOptionLayout;
  min?: number;
  max?: number;
  step?: number;
  minLength?: number;
  maxLength?: number;
  validatePhone?: boolean;
  validateEmail?: boolean;
  fileAccept?: string;
  maxFileSizeMb?: number;
  unit?: '\u20BD' | '\u043C\u00B2' | '\u0448\u0442' | '\u0434\u043D\u0435\u0439' | '\u0447\u0430\u0441\u043E\u0432';
  showCurrentValue?: boolean;
  showScale?: boolean;
  hideScaleNumbers?: boolean;
  allowManualInput?: boolean;
  resultFormula?: string;
  resultPrefix?: string;
  resultSuffix?: string;
  resultRounding?: boolean;
  resultDecimals?: number;
  resultFormat?: ResultFieldFormat;
  resultDisplayMode?: ResultDisplayMode;
  resultVisibilityCondition?: string;
  bookingWeekdays?: number[];
  bookingStartTime?: string;
  bookingEndTime?: string;
  bookingCustomSlots?: string[];
  bookingSlotDuration?: number;
  bookingSlotBreak?: number;
  bookingExcludedDates?: string[];
  bookingMinDate?: string;
  bookingMaxDate?: string;
  bookingMaxRequestsPerSlot?: number;
  bookingUrgentSurcharge?: number;
  bookingUrgentThresholdHours?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
}

export interface CalculatorTemplate {
  id: string;
  folderId?: string;
  title: string;
  description: string;
  requestForm: CalculatorRequestFormSettings;
  publicationStatus: CalculatorPublicationStatus;
  publicId: string;
  publishedAt?: string;
  lastModifiedBy: string;
  type: CalculatorType;
  basePrice: number;
  discount: number;
  minPrice: number;
  globalCoefficient: number;
  formulaMode: FormulaMode;
  customFormula: string;
  resultCardTitle?: string;
  resultCardShowTitle?: boolean;
  resultSubtotalLabel?: string;
  resultCardShowSubtotal?: boolean;
  resultDiscountLabel?: string;
  resultCardShowDiscount?: boolean;
  resultMinPriceLabel?: string;
  resultCardShowMinPrice?: boolean;
  fields: CalculatorField[];
  createdAt: string;
  updatedAt: string;
}

export interface CalculatorFolder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CalculatorAdminSettings {
  managerVkId: string;
}

export type CalculatorSupportTicketType = 'message' | 'bug' | 'suggestion';

export interface CalculatorSupportTicket {
  id: string;
  type: CalculatorSupportTicketType;
  subject: string;
  message: string;
  createdAt: string;
  authorLabel: string;
}

export interface CalculatorUploadedFile {
  name: string;
  size: number;
  type: string;
}

export interface CalculatorBookingValue {
  date: string;
  time: string;
  dateTime: string;
  label: string;
  surcharge: number;
  isUrgent: boolean;
}

export type CalculatorFieldValue =
  | string
  | number
  | boolean
  | CalculatorUploadedFile[]
  | CalculatorBookingValue;
export type CalculatorValues = Record<string, CalculatorFieldValue>;

export interface CalculationBreakdownItem {
  fieldId: string;
  label: string;
  valueLabel: string;
  amount: number;
}

export interface CalculationResult {
  total: number;
  subtotal: number;
  discountAmount: number;
  breakdown: CalculationBreakdownItem[];
}

export interface CalculatorRequest {
  id: string;
  templateId: string;
  templateTitle: string;
  name: string;
  phone: string;
  comment: string;
  amount: number;
  createdAt: string;
  values: CalculatorValues;
}
