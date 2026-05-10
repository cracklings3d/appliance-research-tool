# MVP schema and option contracts

This directory defines the MVP JSON contracts for:

- `washer`
- `dryer`
- `laundry-set`

These contracts are the source of truth for storage and renderer integration.

## 1) Appliance schema file format

Each appliance schema file uses this shape:

```json
{
  "schemaVersion": "1.0",
  "appliance": "washer | dryer | laundry-set",
  "displayName": "Human-readable appliance name",
  "pointerDimensionsAllowed": false,
  "requiredDimensionIds": ["brand", "model"],
  "defaultListOrder": [
    { "dimensionId": "price", "direction": "asc" }
  ],
  "defaultComparisonDimensionIds": ["brand", "model", "price"],
  "dimensions": [
    {
      "id": "brand",
      "label": "Brand",
      "type": "string",
      "required": true
    }
  ]
}
```

### Allowed dimension types (MVP)

- `boolean`
- `enum`
- `numeric`
- `string`
- `pointer`

### Rules

- `brand` and `model` are regular schema-defined Dimensions (not built-ins).
- Pointer Dimensions are only valid on `laundry-set` schema (`pointerDimensionsAllowed: true`).
- `numeric` filtering remains range-based only (min/max input behavior).

## 2) Option file format

Each appliance options fixture uses this shape:

```json
{
  "contractVersion": "1.0",
  "appliance": "washer | dryer | laundry-set",
  "options": [
    {
      "id": "stable-option-id",
      "evaluations": {
        "brand": { "status": "known", "value": "Samsung" },
        "sourceUrl": { "status": "na" }
      }
    }
  ]
}
```

### Stable internal ID

- `options[].id` is the stable app-level internal identifier.
- It is independent from schema-defined Dimensions such as `model`.

## 3) Evaluation wrapper contract

MVP Evaluation shape is explicit:

- Known value:
  ```json
  { "status": "known", "value": "<typed value>" }
  ```
- N/A value:
  ```json
  { "status": "na" }
  ```

MVP statuses are limited to `known` and `na`.

## 4) Pointer Evaluation contract (`laundry-set` only)

Pointer Evaluation stores only the target Option ID:

```json
{ "status": "known", "value": "opt-washer-samsung-ww7000" }
```

`status: "na"` is allowed for N/A pointer values, but laundry set save workflows should require both washer and dryer pointers.

## 5) Included fixtures

- `fixtures/washer.options.sample.json`
- `fixtures/dryer.options.sample.json`
- `fixtures/laundry-set.options.sample.json`

The laundry set fixtures include:

- one valid pointer pair
- one broken pointer scenario for incomplete-set handling tests
