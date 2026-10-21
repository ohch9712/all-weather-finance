import { z } from "zod";
import type { AssetKind, DonorGroup, Health, ParentRole, SuccessionInput } from "./types";

// 화면 입력값. 숫자 칸은 지우고 다시 쓰기 쉽도록 문자열로 두고, 보낼 때 SuccessionInput으로 바꾼다.

export interface ParentForm {
  role: ParentRole;
  alive: boolean;
  age: string;
  health: Health | "";
  lifeExpectancyYears: string;
}

export interface AssetForm {
  id: string;
  kind: AssetKind;
  label: string;
  value: string;
  officialPrice: string;
  region: string;
  regulated: boolean;
  over85: boolean;
  loan: string;
  acquiredOn: string;
  acquisitionCost: string;
  residedYears: string;
  regulatedAtAcquisition: boolean;
  parentsLiveHere: boolean;
  nonBusinessLand: boolean;
}

export interface GiftForm {
  giftedOn: string;
  donorGroup: DonorGroup;
  amount: string;
  taxPaid: string;
}

export interface ChildForm {
  id: string;
  displayName: string;
  isSelf: boolean;
  age: string;
  houseCount: string;
  pastGifts: GiftForm[];
}

export interface AssumptionsForm {
  annualGrowthRate: string;
  costInflationRate: string;
  careMonthlyCost: string;
  careYears: string;
  officialPriceRatio: string;
}

export interface SuccessionForm {
  baseDate: string;
  parents: ParentForm[];
  ownerRole: ParentRole;
  monthlyLivingCost: string;
  monthlyIncome: string;
  parentsHouseCount: string;
  assets: AssetForm[];
  children: ChildForm[];
  assumptions: AssumptionsForm;
}

export const MAX_ASSETS = 20;
export const MAX_CHILDREN = 10;
export const MAX_GIFTS = 20;
const TRILLION = 1_000_000_000_000;
const HUNDRED_MILLION = 100_000_000;

export const DEFAULT_ASSUMPTIONS: AssumptionsForm = {
  annualGrowthRate: "3",
  costInflationRate: "2",
  careMonthlyCost: "2000000",
  careYears: "2",
  officialPriceRatio: "70",
};

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyAsset(kind: AssetKind = "cash"): AssetForm {
  return {
    id: newId("asset"),
    kind,
    label: "",
    value: "",
    officialPrice: "",
    region: "",
    regulated: false,
    over85: false,
    loan: "",
    acquiredOn: "",
    acquisitionCost: "",
    residedYears: "",
    regulatedAtAcquisition: false,
    parentsLiveHere: false,
    nonBusinessLand: false,
  };
}

export function emptyChild(isSelf = false): ChildForm {
  return { id: newId("child"), displayName: isSelf ? "나" : "", isSelf, age: "", houseCount: "0", pastGifts: [] };
}

export function emptyGift(): GiftForm {
  return { giftedOn: "", donorGroup: "parents", amount: "", taxPaid: "" };
}

export function defaultForm(): SuccessionForm {
  return {
    baseDate: "",
    parents: [
      { role: "father", alive: true, age: "", health: "", lifeExpectancyYears: "" },
      { role: "mother", alive: true, age: "", health: "", lifeExpectancyYears: "" },
    ],
    ownerRole: "father",
    monthlyLivingCost: "",
    monthlyIncome: "",
    parentsHouseCount: "0",
    assets: [{ ...emptyAsset("cash"), label: "현금·예금" }],
    children: [emptyChild(true)],
    assumptions: { ...DEFAULT_ASSUMPTIONS },
  };
}

// ── 검증 ─────────────────────────────────────────────────────────────

const digits = (text: string) => text.replace(/[,\s]/g, "");
export function parseInteger(text: string): number | null {
  const value = digits(text);
  return /^\d+$/.test(value) ? Number(value) : null;
}

function integer(min: number, max: number, message: string, optional = false) {
  return z.string().refine((text) => {
    if (!digits(text)) return optional;
    const value = parseInteger(text);
    return value !== null && value >= min && value <= max;
  }, message);
}

function decimal(min: number, max: number, places: number, message: string, optional = false) {
  const pattern = new RegExp(`^\\d+(\\.\\d{1,${places}})?$`);
  return z.string().refine((text) => {
    const value = text.trim();
    if (!value) return optional;
    return pattern.test(value) && Number(value) >= min && Number(value) <= max;
  }, message);
}

const money = (message = "0원~1조 원으로 입력해 주세요.") => integer(0, TRILLION, message);
const optionalMoney = integer(0, TRILLION, "0원~1조 원으로 입력해 주세요.", true);
const monthly = integer(0, HUNDRED_MILLION, "0원~1억 원으로 입력해 주세요.", true);

const parentSchema = z
  .object({
    role: z.enum(["father", "mother"]),
    alive: z.boolean(),
    age: z.string(),
    health: z.enum(["good", "normal", "poor", "care", ""]),
    lifeExpectancyYears: decimal(0.5, 60, 1, "0.5~60년으로 입력해 주세요(소수 첫째 자리까지).", true),
  })
  .superRefine((parent, ctx) => {
    const age = parseInteger(parent.age);
    if (parent.alive && (age === null || age < 40 || age > 110)) {
      ctx.addIssue({ code: "custom", path: ["age"], message: "40~110세로 입력해 주세요." });
    }
  });

const assetSchema = z.object({
  id: z.string().min(1).max(36),
  kind: z.enum(["cash", "house", "land"]),
  label: z.string().trim().min(1, "이름을 입력해 주세요.").max(30, "30자 이내로 입력해 주세요."),
  value: money("금액을 0원~1조 원으로 입력해 주세요."),
  officialPrice: optionalMoney,
  region: z.string(),
  regulated: z.boolean(),
  over85: z.boolean(),
  loan: optionalMoney,
  acquiredOn: z.string(),
  acquisitionCost: optionalMoney,
  residedYears: integer(0, 80, "0~80년으로 입력해 주세요.", true),
  regulatedAtAcquisition: z.boolean(),
  parentsLiveHere: z.boolean(),
  nonBusinessLand: z.boolean(),
});

const giftSchema = z.object({
  giftedOn: z.string().min(1, "증여일을 입력해 주세요."),
  donorGroup: z.enum(["parents", "grandparents"]),
  amount: integer(1, TRILLION, "1원~1조 원으로 입력해 주세요."),
  taxPaid: optionalMoney,
});

const childSchema = z.object({
  id: z.string().min(1).max(36),
  displayName: z.string().trim().min(1, "이름을 입력해 주세요.").max(20, "20자 이내로 입력해 주세요."),
  isSelf: z.boolean(),
  age: integer(19, 90, "19~90세로 입력해 주세요."),
  houseCount: integer(0, 20, "0~20채로 입력해 주세요."),
  pastGifts: z.array(giftSchema).max(MAX_GIFTS),
});

export const successionSchema = z
  .object({
    baseDate: z.string(),
    parents: z.array(parentSchema).min(1).max(2),
    ownerRole: z.enum(["father", "mother"]),
    monthlyLivingCost: monthly,
    monthlyIncome: monthly,
    parentsHouseCount: integer(0, 20, "0~20채로 입력해 주세요."),
    assets: z.array(assetSchema).min(1, "재산을 하나 이상 입력해 주세요.").max(MAX_ASSETS),
    children: z.array(childSchema).min(1, "자녀를 한 명 이상 입력해 주세요.").max(MAX_CHILDREN),
    assumptions: z.object({
      annualGrowthRate: decimal(0, 10, 2, "0~10%로 입력해 주세요."),
      costInflationRate: decimal(0, 10, 2, "0~10%로 입력해 주세요."),
      careMonthlyCost: integer(0, HUNDRED_MILLION, "0원~1억 원으로 입력해 주세요."),
      careYears: integer(0, 20, "0~20년으로 입력해 주세요."),
      officialPriceRatio: decimal(10, 100, 2, "10~100%로 입력해 주세요."),
    }),
  })
  .superRefine((form, ctx) => {
    const alive = form.parents.filter((parent) => parent.alive);
    if (!alive.length) {
      ctx.addIssue({ code: "custom", path: ["parents"], message: "살아 계신 부모님을 한 분 이상 입력해 주세요." });
    } else if (!alive.some((parent) => parent.role === form.ownerRole)) {
      ctx.addIssue({ code: "custom", path: ["ownerRole"], message: "재산 명의자는 살아 계신 부모님이어야 해요." });
    }
    const houses = form.assets.filter((asset) => asset.kind === "house").length;
    const count = parseInteger(form.parentsHouseCount);
    if (count !== null && count < houses) {
      ctx.addIssue({ code: "custom", path: ["parentsHouseCount"], message: "입력한 주택 수보다 적을 수 없어요." });
    }
    if (form.children.filter((child) => child.isSelf).length > 1) {
      ctx.addIssue({ code: "custom", path: ["children"], message: "본인은 한 명만 고를 수 있어요." });
    }
  });

// ── 변환 ─────────────────────────────────────────────────────────────

const orNull = (text: string) => (text.trim() ? text.trim() : null);
const toNumber = (text: string, fallback: number) => parseInteger(text) ?? fallback;
const toOptionalNumber = (text: string) => parseInteger(text);
const toText = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));

export function toInput(form: SuccessionForm): SuccessionInput {
  return {
    baseDate: orNull(form.baseDate),
    parents: form.parents.map((parent) => ({
      role: parent.role,
      alive: parent.alive,
      age: parent.alive ? toOptionalNumber(parent.age) : null,
      health: parent.alive && parent.health ? parent.health : null,
      lifeExpectancyYears: parent.alive ? orNull(parent.lifeExpectancyYears) : null,
    })),
    ownerRole: form.ownerRole,
    monthlyLivingCost: toNumber(form.monthlyLivingCost, 0),
    monthlyIncome: toNumber(form.monthlyIncome, 0),
    parentsHouseCount: toNumber(form.parentsHouseCount, 0),
    assets: form.assets.map((asset) => {
      const realEstate = asset.kind !== "cash";
      const house = asset.kind === "house";
      return {
        id: asset.id,
        kind: asset.kind,
        label: asset.label.trim(),
        value: toNumber(asset.value, 0),
        officialPrice: realEstate ? toOptionalNumber(asset.officialPrice) : null,
        region: realEstate ? orNull(asset.region) : null,
        regulated: realEstate && asset.regulated,
        over85: house && asset.over85,
        loan: toNumber(asset.loan, 0),
        acquiredOn: realEstate ? orNull(asset.acquiredOn) : null,
        acquisitionCost: realEstate ? toOptionalNumber(asset.acquisitionCost) : null,
        residedYears: house ? toNumber(asset.residedYears, 0) : 0,
        regulatedAtAcquisition: house && asset.regulatedAtAcquisition,
        parentsLiveHere: house && asset.parentsLiveHere,
        nonBusinessLand: asset.kind === "land" && asset.nonBusinessLand,
      };
    }),
    children: form.children.map((child) => ({
      id: child.id,
      displayName: child.displayName.trim(),
      isSelf: child.isSelf,
      age: toNumber(child.age, 0),
      houseCount: toNumber(child.houseCount, 0),
      pastGifts: child.pastGifts.map((gift) => ({
        giftedOn: gift.giftedOn,
        donorGroup: gift.donorGroup,
        amount: toNumber(gift.amount, 0),
        taxPaid: toNumber(gift.taxPaid, 0),
      })),
    })),
    assumptions: {
      annualGrowthRate: form.assumptions.annualGrowthRate.trim(),
      costInflationRate: form.assumptions.costInflationRate.trim(),
      careMonthlyCost: toNumber(form.assumptions.careMonthlyCost, 0),
      careYears: toNumber(form.assumptions.careYears, 0),
      officialPriceRatio: form.assumptions.officialPriceRatio.trim(),
    },
  };
}

export function fromInput(input: SuccessionInput): SuccessionForm {
  const parents = (["father", "mother"] as const).map((role): ParentForm => {
    const parent = input.parents.find((item) => item.role === role);
    return {
      role,
      alive: parent ? parent.alive : false,
      age: toText(parent?.age),
      health: parent?.health ?? "",
      lifeExpectancyYears: parent?.lifeExpectancyYears ?? "",
    };
  });
  return {
    baseDate: input.baseDate ?? "",
    parents,
    ownerRole: input.ownerRole,
    monthlyLivingCost: toText(input.monthlyLivingCost),
    monthlyIncome: toText(input.monthlyIncome),
    parentsHouseCount: toText(input.parentsHouseCount),
    assets: input.assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      label: asset.label,
      value: toText(asset.value),
      officialPrice: toText(asset.officialPrice),
      region: asset.region ?? "",
      regulated: asset.regulated,
      over85: asset.over85,
      loan: asset.loan ? String(asset.loan) : "",
      acquiredOn: asset.acquiredOn ?? "",
      acquisitionCost: toText(asset.acquisitionCost),
      residedYears: asset.residedYears ? String(asset.residedYears) : "",
      regulatedAtAcquisition: asset.regulatedAtAcquisition,
      parentsLiveHere: asset.parentsLiveHere,
      nonBusinessLand: asset.nonBusinessLand,
    })),
    children: input.children.map((child) => ({
      id: child.id,
      displayName: child.displayName,
      isSelf: child.isSelf,
      age: String(child.age),
      houseCount: String(child.houseCount),
      pastGifts: child.pastGifts.map((gift) => ({
        giftedOn: gift.giftedOn,
        donorGroup: gift.donorGroup,
        amount: String(gift.amount),
        taxPaid: gift.taxPaid ? String(gift.taxPaid) : "",
      })),
    })),
    assumptions: {
      annualGrowthRate: input.assumptions.annualGrowthRate,
      costInflationRate: input.assumptions.costInflationRate,
      careMonthlyCost: String(input.assumptions.careMonthlyCost),
      careYears: String(input.assumptions.careYears),
      officialPriceRatio: input.assumptions.officialPriceRatio,
    },
  };
}
