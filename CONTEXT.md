# Appliance Research Tool

A desktop application for planning and comparing different options for buying appliances.

## Language

**Appliance**:
A category or type of product being researched for purchase.
_Examples_: Refrigerator, Washing Machine, Dishwasher, Air Conditioner
_Avoid_: Product, item, device

**Research Session**:
A focused investigation into options for a specific Appliance category.
_Avoid_: Project, study, analysis

**Option**:
A specific model or SKU available for purchase within an Appliance category.
_Examples_: "Samsung WW7000 Washing Machine", "LG InstaView Refrigerator"
_Avoid_: Product, item, SKU, model

**Criteria**:
A measurable or comparable attribute used to evaluate Options.
_Examples_: Price, Energy Rating (star), Warranty period, Annual energy consumption (kWh)
_Avoid_: Feature, attribute, specification

**Evaluation**:
A specific measurement or rating of an Option against a Criteria.
_Example_: "Energy Rating: 4.5 stars" or "Price: $1,299"
_Avoid_: Score, rating, comparison result

**Comparison**:
The act or result of placing two or more Options side-by-side across one or more Criteria.
_Avoid_: Analysis, side-by-side view

**Source**:
A retailer, manufacturer, or third-party site from which research data is gathered.
_Examples_: Best Buy, Manufacturer website, Consumer Reports
_Avoid_: Website, retailer, vendor

## Relationships

- A **Research Session** focuses on exactly one **Appliance**
- A **Research Session** contains two or more **Options**
- An **Option** is evaluated against one or more **Criteria**, producing an **Evaluation**
- **Options** may share the same or different **Sources**

## Example Dialogue

> **Dev:** "When starting a new **Research Session** for 'Washing Machine', does the user pick from a predefined list of **Appliances** or enter a custom one?"
> **Domain expert:** "Predefined list to start — but they can add custom **Appliances** later."
>
> **Dev:** "Can an **Option** have multiple **Evaluations** for the same **Criteria** from different **Sources**?"
> **Domain expert:** "Yes — e.g., Price from Best Buy vs. Price from Home Depot for the same washing machine model."

## Flagged Ambiguities

- "Model" was used to mean both the **Option** (specific SKU) and the **Appliance** (type) — resolved: use "Option" for specific SKUs, "Appliance" for categories.
- "Rating" was ambiguous — could mean Energy Star rating, user review score, or general quality — resolved: use "Evaluation" for tracked measurements, "Review" for user-submitted scores.
