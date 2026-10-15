"use strict";

const crypto = require("crypto");

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function normalizedRecipeBundle(recipe) {
  const bundle = recipe.bundle || {};
  return {
    id: recipe.id,
    name: recipe.name,
    revision: recipe.revision,
    contentVersion: recipe.contentVersion,
    rulesVersion: recipe.rulesVersion,
    targetId: recipe.targetId,
    formulaSourceId: recipe.formulaSourceId,
    sourceIds: recipe.sourceIds,
    safetySourceIds: recipe.safetySourceIds,
    sourceLocator: recipe.sourceLocator,
    sourceContext: recipe.sourceContext,
    guideContext: recipe.guideContext,
    audience: recipe.audience,
    historicNotes: recipe.historicNotes,
    currentContext: recipe.currentContext,
    servingText: bundle.servingText,
    frequencyText: bundle.frequencyText,
    courseText: bundle.courseText,
    ingredients: (bundle.ingredients || []).map((line) => ({
      lineId: line.lineId,
      required: line.required,
      ingredientRegistry: line.ingredientRegistry,
      ingredientId: line.ingredientId,
      ingredientContentVersion: line.ingredientContentVersion,
      ingredientSnapshotDigest: line.ingredientSnapshotDigest,
      sourceName: line.sourceName,
      sourcePartText: line.sourcePartText,
      processingText: line.processingText,
      identityReviewState: line.identityReviewState,
      identitySourceIds: line.identitySourceIds,
      quantitySourceIds: line.quantitySourceIds,
      useRole: line.useRole,
      allergenKeys: line.allergenKeys,
      quantity: line.quantity,
      sourceIds: line.sourceIds
    })),
    steps: (bundle.steps || []).map((step) => ({
      stepId: step.stepId, order: step.order, text: step.text, sourceIds: step.sourceIds
    })),
    safety: recipe.safety
  };
}

function normalizedRecipeSourceText(recipe) {
  const bundle = recipe.bundle || {};
  return {
    formulaSourceId: recipe.formulaSourceId,
    sourceLocator: recipe.sourceLocator,
    servingText: bundle.servingText,
    frequencyText: bundle.frequencyText,
    courseText: bundle.courseText,
    ingredients: (bundle.ingredients || []).map((line) => ({
      sourceName: line.sourceName,
      sourcePartText: line.sourcePartText,
      processingText: line.processingText,
      quantity: line.quantity
    })),
    steps: (bundle.steps || []).map((step) => ({ order: step.order, text: step.text }))
  };
}

function expectedRecipeBundleDigest(recipe) {
  return sha256(normalizedRecipeBundle(recipe));
}

function expectedRecipeSourceTextDigest(recipe) {
  return sha256(normalizedRecipeSourceText(recipe));
}

function normalizedIngredientReviewContent(ingredient) {
  if (!ingredient || typeof ingredient !== "object" || Array.isArray(ingredient)) return ingredient;
  const { audit, ...content } = ingredient;
  return content;
}

function expectedIngredientReviewDigest(ingredient) {
  return sha256(normalizedIngredientReviewContent(ingredient));
}

function expectedIngredientSnapshotDigest(ingredient) {
  return expectedIngredientReviewDigest(ingredient);
}

function expectedExternalFoodSnapshotDigest(food) {
  if (!food || typeof food !== "object" || Array.isArray(food)) {
    return sha256({ domain: "external_food_v2", content: food });
  }
  const directSourceIds = new Set([
    ...((food.identity && food.identity.sourceIds) || []),
    ...((food.regulatory && food.regulatory.sourceIds) || []),
    ...((food.foodUse && food.foodUse.sourceIds) || []),
    ...((food.safety && food.safety.sourceIds) || [])
  ]);
  const directSources = (Array.isArray(food.sources) ? food.sources : []).filter((source) =>
    source && directSourceIds.has(source.id)
  );
  return sha256({
    domain: "external_food_v2",
    content: {
      id: food.id,
      recordKind: food.recordKind,
      contentVersion: food.contentVersion,
      name: food.name,
      aliases: food.aliases,
      category: food.category,
      occurrenceFormText: food.occurrenceFormText,
      identity: food.identity,
      regulatory: food.regulatory,
      foodUse: food.foodUse,
      safety: food.safety,
      sources: directSources
    }
  });
}

function expectedRecipeIngredientSnapshotDigest(record, registry) {
  return registry === "external_food"
    ? expectedExternalFoodSnapshotDigest(record)
    : expectedIngredientSnapshotDigest(record);
}

module.exports = {
  expectedIngredientReviewDigest,
  expectedIngredientSnapshotDigest,
  expectedExternalFoodSnapshotDigest,
  expectedRecipeIngredientSnapshotDigest,
  expectedRecipeBundleDigest,
  expectedRecipeSourceTextDigest,
  normalizedRecipeBundle,
  normalizedRecipeSourceText,
  normalizedIngredientReviewContent
};
