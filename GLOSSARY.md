# Glossary

Domain terms for the Appliance Research Tool. These definitions are the authoritative source for project vocabulary.

## Core Terms

**Appliance** (or **Category**):
A type of product being researched. Each Appliance has its own JSON schema defining its Dimensions.
_Examples_: Laundry Set, Refrigerator, Air Conditioner
_Avoid_: Product, item, device

**Laundry Set**:
A bundle combining a washer and a dryer, offered by manufacturers at a discount. Contains pointers to individual washer and dryer Options.
_Avoid_: Bundle, package, combo

**Option** (or **Model**):
A specific product (SKU) within an Appliance category. May belong to a Laundry Set as a sub-item.
_Examples_: "Samsung WW7000 Washing Machine", "Midea MT25 Heat Pump Dryer"
_Avoid_: Product, SKU

**Dimension** (or **Field**):
A measurable or comparable attribute of an Option, used for filtering and ranking. Defined per-Appliance in a JSON schema. Users can add custom Dimensions beyond the defaults.
_Examples_: Price, Capacity, Energy Level, Heat Pump Type
_Avoid_: Criteria, feature, attribute, specification

**Evaluation**:
The measured or observed value of an Option on a specific Dimension. May be N/A if the value is not accessible from the Source.
_Examples_: "Price: ¥3,299", "Energy Level: Level 2", "Capacity: 10kg"
_Avoid_: Rating, score

**Filter**:
A constraint applied to a list of Options. Filter logic per type:
- **Boolean**: exact match (true/false)
- **Enum**: one or more selected values
- **Numeric**: range, possibly open on one end (e.g., ≥500 or ≤2000 or 300-800)
_Avoid_: Search, query

**Rank** (or **Order**):
The sorting of Options by a Dimension, ascending or descending. Uses the same Dimensions as Filter.
_Avoid_: Sort, sort order

**Source**:
A retailer, manufacturer, or third-party site from which data was gathered.
_Examples_: Taobao, JD.com, Manufacturer website
_Avoid_: Website, retailer, vendor

**N/A**:
A value that is not accessible from the Source. When a Filter is applied, an N/A value should trigger a visible Warning in the GUI, not a failed match.

## Commonly Used Dimensions

These Dimensions are commonly useful across Appliances, but each Appliance schema decides which Dimensions exist and which are required:

| Dimension | Type | Description |
|-----------|------|-------------|
| `price` | Numeric | Price in local currency |
| `capacity` | Numeric | Capacity in kg (laundry) or liters (refrigerators) |
| `energyLevel` | Enum | Energy efficiency: Level 1 (best) to Level 5 (worst), per GB12021.4-2026 |
| `brand` | String | Manufacturer brand name |
| `model` | String | Model name/number |
| `sourceUrl` | String | URL of the product page |
| `imageUrl` | String | URL of product image |
| `warranty` | Numeric | Warranty period in months |

## Laundry Set Dimensions

**Pointer Dimensions:**

| Dimension | Type | Description |
|-----------|------|-------------|
| `washer` | Pointer | Reference to a washer Option |
| `dryer` | Pointer | Reference to a dryer Option |
| `bundlePrice` | Numeric | Total price of the bundle |

**Dryer-Specific Dimensions:**

| Dimension | Type | Description |
|-----------|------|-------------|
| `heatPumpType` | Enum | Heat Pump / Condensing / Ventless / Exhaust |
| `motorDrive` | Enum | Direct Drive / Belt Drive |
| `hasInverterCompressor` | Boolean | Has inverter compressor |
| `hasInverterMotor` | Boolean | Has inverter motor |
| `hasRotation1to1` | Boolean | Has 1:1 forward:reverse rotation |
| `hasAutoFlush` | Boolean | Has automatic condenser/evaporator flushing |
| `hasDownCoatProgram` | Boolean | Has dedicated down coat drying program |
| `woolmarkLicense` | Enum | Woolmark certification: Green / Blue / None |
| `annualEnergyKwh` | Numeric | Annual energy consumption in kWh |
| `noiseLevel` | Numeric | Noise level in dB |
| `drumMaterial` | Enum | Stainless Steel / Galvanized / Other |
| `finType` | Enum | Wave fin / Regular fin / Other |

## Relationships

- An **Appliance** defines a set of **Dimensions** via JSON schema
- A **Laundry Set** (Appliance) contains **Pointers** to washer and dryer **Options**
- An **Option** has an **Evaluation** for each **Dimension** (may be N/A)
- **Options** may share the same **Source** or have different Sources
