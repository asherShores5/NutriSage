# NutriSage

A nutrition tracker for one household. Each person logs what they eat and drink each day against their own goals, drawing on a shared Library of Foods and Recipes.

## Language

### Logging

**Day**:
One person's log for one calendar date: their Entries, water and weight.
_Avoid_: Log, diary

**Meal**:
The time slot an Entry belongs to: Breakfast, Lunch, Dinner, Dessert or Snack.
_Avoid_: Mealtime, course (and never use "Meal" for a dish; that is a Recipe)

**Entry**:
An amount of one Food or Recipe logged into a Meal on a Day.
_Avoid_: Item, log line

**Meal window**:
A Member's time-of-day range for each Meal, used to pre-select the Meal when logging.
_Avoid_: Schedule, meal times

### Library

**Library**:
The household's shared collection of every Food and Recipe anyone has saved or logged.
_Avoid_: Meal library, database

**Food**:
A single Library item with known nutrition per unit.
_Avoid_: Ingredient (except when it is used inside a Recipe), item

**Recipe**:
A saved combination of Foods (its ingredients) with a prepared weight.
_Avoid_: Meal, dish, combo

**Prepared weight**:
The total weight of a Recipe once it is cooked, either weighed or estimated from Yield ratios.
_Avoid_: Cooked weight, batch weight

**Yield ratio**:
How a Food's weight changes from raw to prepared (e.g. dry rice ×2.5, raw chicken ×0.75).
_Avoid_: Cook factor, conversion

**Recipe Book**:
The part of the Library that holds Recipes.
_Avoid_: Cookbook, saved meals

**Favorite**:
A Library item one person has starred.
_Avoid_: Pin, saved food

**Quick Add**:
One person's Favorites, most recently used first.
_Avoid_: Recents, shortcuts

### People

**Member**:
A signed-in person in the household (asher, aubyn), with their own Days, goals and Favorites.
_Avoid_: Profile, user, account

**Guest**:
Someone using NutriSage without signing in. A Guest's data stays on their own device.
_Avoid_: Demo user, anonymous user
