type GiftTableData = Record<string, string>;

type GiftFilterCondition = {
  field: string;
  value: string;
};

type GiftFilterConfig = {
  conditions: GiftFilterCondition[];
};

type ParseGiftFilterResult =
  | {
      ok: true;
      config: GiftFilterConfig;
    }
  | {
      ok: false;
      error: string;
    };

function parseGiftFilterConfig(input: string): ParseGiftFilterResult {
  const normalizedInput = input.trim();
  if (!normalizedInput) {
    return {
      ok: false,
      error: "Filter cannot be empty.",
    };
  }

  const conditionParts = normalizedInput
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (conditionParts.length === 0) {
    return {
      ok: false,
      error: "Filter must contain at least one condition.",
    };
  }

  const conditions: GiftFilterCondition[] = [];

  for (const conditionPart of conditionParts) {
    const separatorIndex = conditionPart.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === conditionPart.length - 1) {
      return {
        ok: false,
        error: `Invalid condition "${conditionPart}". Expected field:value.`,
      };
    }

    const field = conditionPart.slice(0, separatorIndex).trim().toLowerCase();
    const rawValue = conditionPart.slice(separatorIndex + 1).trim();

    if (!field) {
      return {
        ok: false,
        error: `Invalid condition "${conditionPart}". Field cannot be empty.`,
      };
    }

    if (!rawValue) {
      return {
        ok: false,
        error: `Invalid condition "${conditionPart}". Value cannot be empty.`,
      };
    }

    if (rawValue.includes("|")) {
      return {
        ok: false,
        error: `Invalid condition "${conditionPart}". Use commas between conditions, for example: ${field}:a,${field}:b`,
      };
    }

    conditions.push({ field, value: rawValue.toLowerCase() });
  }

  return {
    ok: true,
    config: { conditions },
  };
}

function stringifyGiftFilterConfig(config: GiftFilterConfig): string {
  return config.conditions.map((condition) => `${condition.field}:${condition.value}`).join(",");
}

function getMatchingGiftFilterConditions(
  config: GiftFilterConfig,
  giftTable: GiftTableData,
): GiftFilterCondition[] {
  const normalizedGiftTable = new Map<string, string>();

  for (const [field, value] of Object.entries(giftTable)) {
    normalizedGiftTable.set(field.toLowerCase(), value.toLowerCase());
  }

  const matchingConditions: GiftFilterCondition[] = [];

  for (const condition of config.conditions) {
    const giftValue = normalizedGiftTable.get(condition.field);
    if (!giftValue) {
      continue;
    }

    if (giftValue.includes(condition.value)) {
      matchingConditions.push(condition);
    }
  }

  return matchingConditions;
}

function matchesGiftFilterConfig(config: GiftFilterConfig, giftTable: GiftTableData): boolean {
  return getMatchingGiftFilterConditions(config, giftTable).length > 0;
}

export {
  getMatchingGiftFilterConditions,
  matchesGiftFilterConfig,
  parseGiftFilterConfig,
  stringifyGiftFilterConfig,
};
export type { GiftFilterConfig, GiftFilterCondition, GiftTableData, ParseGiftFilterResult };
