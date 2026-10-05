# Requirements Document

## Introduction

The Restaurant POS System is a standalone application that runs entirely on a local machine without an internet connection. It stores all data in a Local_Database (for example SQLite) and enforces Role-Based Access Control with two roles: Owner and Cashier. Cashiers operate the POS Terminal and view the Available Menu List. The Owner additionally manages ingredients, recipes, menu categories, menu dishes, and reviews the analytics dashboard and transaction history.

The system ships with database initialization scripts and seed data: 1 Owner account, 3 Cashier accounts (Cashier 1, Cashier 2, Cashier 3), and demo categories, dishes, ingredients, recipes, and transactions.

## Glossary

- **POS_System**: The complete standalone restaurant point-of-sale application, including user interface, business logic, and Local_Database.
- **Local_Database**: The on-device relational database (for example SQLite) that stores all POS_System data.
- **Auth_Service**: The component of POS_System that verifies credentials, manages sessions, and enforces role permissions.
- **Owner**: A user role with full access to every screen of POS_System.
- **Cashier**: A user role restricted to the POS_Terminal and the Available_Menu_List.
- **Session**: An authenticated period of use for one user, created at login and ended at logout or session expiry.
- **POS_Terminal**: The screen on which a Cashier builds an order, checks out, and submits the order.
- **Order**: A collection of order lines being assembled on the POS_Terminal before submission.
- **Order_Line**: One Dish and its quantity within an Order.
- **Checkout_Screen**: The screen that displays Subtotal, Tax_Amount, Total, Cash_Tendered, and Change_Due for an Order.
- **Subtotal**: The sum of (Selling_Price × quantity) for all Order_Lines in an Order.
- **Tax_Rate**: A percentage, configured by the Owner, applied to the Subtotal. The default value is 0 percent.
- **Tax_Amount**: Subtotal × Tax_Rate, rounded to 2 decimal places using half-up rounding.
- **Total**: Subtotal plus Tax_Amount.
- **Cash_Tendered**: The cash amount entered by the Cashier as received from the customer.
- **Change_Due**: Cash_Tendered minus Total.
- **Transaction**: A persisted record of a completed Order, including a unique receipt number, date and time, handling Cashier, Order_Lines, Subtotal, Tax_Amount, Total, Cash_Tendered, and Change_Due.
- **Category**: A named grouping of Dishes on the menu.
- **Dish**: A menu item that has a name, Category, Selling_Price, Target_Cost, visibility flag, and Recipe.
- **Selling_Price**: The price charged to the customer for one serving of a Dish.
- **Target_Cost**: The Owner-defined intended ingredient cost per serving of a Dish.
- **Serving_Cost**: The sum, over all Recipe_Items of a Dish, of (quantity per serving × Ingredient unit cost).
- **Ingredient**: A raw material with a name, Unit, unit cost, and current stock quantity.
- **Unit**: The unit of measurement of an Ingredient. Permitted values are grams, ml, and pcs.
- **Recipe**: The set of Recipe_Items that define a Dish.
- **Recipe_Item**: A mapping of one Ingredient to the quantity of that Ingredient required per serving of a Dish.
- **Visibility_Flag**: A manual Owner-controlled setting on a Dish that is either visible or hidden.
- **Availability_Status**: A system-computed state of a Dish, either available or unavailable, derived from current Ingredient stock against the Recipe.
- **Orderable_Dish**: A Dish whose Visibility_Flag is visible and whose Availability_Status is available.
- **Available_Menu_List**: The screen that lists all Orderable_Dishes with their Category and Selling_Price.
- **Dashboard**: The Owner-only screen that displays financial cards, top-selling dishes, a sales chart, and the Transaction_Log.
- **Gross_Sales**: The sum of Total over all Transactions in the selected Date_Filter.
- **Net_Revenue**: Gross_Sales minus the sum of recorded Serving_Cost (Serving_Cost × quantity) over all Order_Lines in the selected Date_Filter.
- **Date_Filter**: A selectable period: Today, Past 7 Days, or Past 30 Days.
- **Transaction_Log**: The searchable and filterable table of Transactions on the Dashboard.
- **Seed_Data**: The demo accounts, categories, dishes, ingredients, recipes, and sample Transactions loaded by the initialization scripts.

## Requirements

### Requirement 1: Offline Local Operation and Database Initialization

**User Story:** As a restaurant owner, I want the POS to run fully offline with a local database, so that sales continue when the internet is unavailable.

#### Acceptance Criteria

1. WHILE no network connection is available, THE POS_System SHALL complete every user-facing feature with the same functional results as when a network connection is available, and SHALL NOT present any error caused by the lack of a network connection.
2. THE POS_System SHALL store every record that must persist across application restarts in the Local_Database and SHALL NOT depend on any remote data store.
3. WHEN the initialization script runs against an empty Local_Database, THE POS_System SHALL create every table and constraint defined by the database schema within 10 seconds and SHALL report successful completion.
4. WHEN the seed script runs against an initialized Local_Database, THE POS_System SHALL load the Seed_Data so that each Seed_Data record exists exactly once in the Local_Database, including when the seed script is run more than once.
5. WHEN the initialization script runs against an already initialized Local_Database, THE POS_System SHALL leave the record count and field values of every existing record unchanged and SHALL report successful completion.
6. IF the Local_Database file cannot be opened or read as a valid database at startup, THEN THE POS_System SHALL, within 5 seconds, display an error message that states the database path and the failure reason, SHALL NOT proceed to the main application screen, and SHALL leave the database file unmodified.
7. IF the initialization script fails before all tables and constraints are created, THEN THE POS_System SHALL report a failure that states the failure reason, exit with a non-success status, and roll back so that the Local_Database contains none of the objects created by that run.
8. IF the seed script runs against a Local_Database that has not been initialized, or fails while loading Seed_Data, THEN THE POS_System SHALL report a failure that states the failure reason, exit with a non-success status, and leave the Local_Database with no Seed_Data records added by that run.

### Requirement 2: Seed Accounts and Demo Data

**User Story:** As a tester, I want predefined accounts and demo data, so that I can evaluate every role and module immediately.

#### Acceptance Criteria

1. WHEN the seed script completes successfully, THE Local_Database SHALL contain exactly 1 Owner account and exactly 3 Cashier accounts with the usernames Cashier 1, Cashier 2, and Cashier 3, each with a non-empty initial password.
2. THE POS_System SHALL store each account password as a salted one-way hash, and THE Local_Database SHALL NOT contain any account password in plain text.
3. WHEN the seed script completes successfully, THE Local_Database SHALL contain at least 3 Categories, at least 10 Dishes with each Dish assigned to exactly 1 Category, at least 15 Ingredients, and at least 1 Recipe for each Dish, where each Recipe references at least 1 Ingredient with a quantity greater than 0.
4. WHEN the seed script completes successfully, THE Local_Database SHALL contain at least 20 and at most 200 sample Transactions, each with a transaction date within the 30 days preceding the seed run and each handled by 1 of the 3 Cashiers, such that each Cashier handled at least 1 Transaction.
5. WHEN the seed script completes successfully, THE Local_Database SHALL contain at least 1 Dish whose Availability_Status is unavailable because at least 1 of its Recipe Ingredients has a stock quantity lower than the quantity required to prepare 1 serving of that Dish, and at least 1 Dish whose Availability_Status is available.
6. IF the seed script is run against a Local_Database that already contains seeded data, THEN THE POS_System SHALL leave the existing Owner and Cashier accounts unduplicated, so that the counts in criterion 1 remain exactly 1 Owner and 3 Cashiers.
7. IF the seed script fails before completion, THEN THE POS_System SHALL report an error indicating that seeding failed and SHALL leave the Local_Database without partially seeded data.
8. THE POS_System SHALL document the seeded usernames, roles, and initial passwords in the project documentation.

### Requirement 3: Login and Session Management

**User Story:** As a staff member, I want to log in securely, so that only authorized people can use the POS.

#### Acceptance Criteria

1. IF a user without an active Session requests any screen other than the login screen, THEN THE Auth_Service SHALL redirect the user to the login screen within 2 seconds and SHALL NOT display any content of the requested screen.
2. WHEN a user submits a non-empty username and password that match an existing account, THE Auth_Service SHALL create a Session for that user within 2 seconds.
3. WHEN a Session is created for an Owner, THE POS_System SHALL route the user to the Dashboard within 2 seconds.
4. WHEN a Session is created for a Cashier, THE POS_System SHALL route the user to the POS_Terminal within 2 seconds.
5. IF a user submits a username and password that do not match an existing account, THEN THE Auth_Service SHALL create no Session, SHALL clear the password field, and SHALL display within 2 seconds a single generic message that is identical whether the username or the password was incorrect.
6. IF 5 consecutive login attempts fail for one username, THEN THE Auth_Service SHALL reject every login attempt for that username, including attempts with correct credentials, for 5 minutes starting at the fifth failure, and SHALL display a message indicating that login is temporarily locked. The Auth_Service SHALL apply the same behavior to usernames that do not match any account.
7. WHEN a login attempt succeeds for a username, THE Auth_Service SHALL reset the consecutive failed-attempt count for that username to 0.
8. WHEN a user selects logout, THE Auth_Service SHALL end the Session and route the user to the login screen within 2 seconds.
9. WHEN 30 minutes pass with no user activity in a Session, THE Auth_Service SHALL end the Session, route the user to the login screen, and display a message indicating that the Session expired. User activity means a click, key press, or screen navigation by the user.
10. THE Auth_Service SHALL display each character typed in the password field as a mask character and SHALL NOT display the password in plain text on the login screen.
11. IF a user submits the login form with an empty username or an empty password, THEN THE Auth_Service SHALL create no Session, SHALL NOT count the submission as a failed login attempt, and SHALL display a message indicating which field is required.
12. IF THE Auth_Service cannot verify credentials because of an internal or dependency failure, THEN THE Auth_Service SHALL create no Session, SHALL NOT count the attempt as a failed login attempt, and SHALL display a message indicating that login is temporarily unavailable.

### Requirement 4: Role-Based Navigation and Route Protection

**User Story:** As a restaurant owner, I want cashiers restricted to sales screens, so that sensitive data and settings stay protected.

#### Acceptance Criteria

1. WHILE a Cashier Session is active, THE POS_System SHALL display navigation links for exactly two destinations, the POS_Terminal and the Available_Menu_List, and SHALL display no navigation link for any other screen.
2. WHILE an Owner Session is active, THE POS_System SHALL display navigation links for exactly six destinations, the POS_Terminal, Available_Menu_List, Menu Management, Ingredient Stock Manager, Recipe and Pricing Linker, and Dashboard.
3. IF a Cashier requests a screen other than the POS_Terminal or the Available_Menu_List by direct URL, THEN THE Auth_Service SHALL deny the request, SHALL NOT render any content of the requested screen, and SHALL display an access-denied message within 2 seconds while keeping the Cashier Session active.
4. IF a Cashier calls an Owner-only data operation directly (any create, read, update, or delete operation on menu items, ingredient stock, recipes, prices, or Dashboard data), THEN THE Auth_Service SHALL reject the operation, SHALL return an error indicating insufficient permission, and SHALL leave stored data unchanged.
5. WHILE an Owner Session is active, THE Auth_Service SHALL permit every screen and every operation available in the POS_System and SHALL NOT display an access-denied message for any of them.
6. THE Auth_Service SHALL evaluate the role of the current session on the server side for every request to a protected screen or operation, before rendering the screen or executing the operation, independent of navigation link visibility.
7. IF a request to a protected screen or operation arrives with no active Cashier Session or Owner Session, THEN THE Auth_Service SHALL deny the request, SHALL NOT render the screen or execute the operation, SHALL leave stored data unchanged, and SHALL direct the user to the sign-in screen.

### Requirement 5: Order Building on the POS Terminal

**User Story:** As a cashier, I want to tap menu items to build an order, so that I can record what the customer wants quickly.

#### Acceptance Criteria

1. WHEN the POS_Terminal order screen is opened, THE POS_Terminal SHALL display every Category that contains at least one Orderable_Dish and SHALL NOT display any Category that contains zero Orderable_Dishes.
2. WHEN a Cashier selects a Category, THE POS_Terminal SHALL display, within 1 second, every Orderable_Dish of that Category with its name and its Selling_Price formatted with 2 decimal places.
3. WHEN a Cashier taps an Orderable_Dish that is not yet in the Order, THE POS_Terminal SHALL add an Order_Line for that Dish with quantity 1 and SHALL recalculate the Subtotal within 1 second.
4. WHEN a Cashier taps an Orderable_Dish that already exists in the Order and the resulting quantity would be 99 or less and within the number of servings that current Ingredient stock supports, THE POS_Terminal SHALL increase the quantity of that Order_Line by 1 and SHALL recalculate the Subtotal within 1 second.
5. WHEN a Cashier changes the quantity of an Order_Line to a whole number from 1 to 99 that is within the number of servings that current Ingredient stock supports, THE POS_Terminal SHALL update that Order_Line and SHALL recalculate the Subtotal as the sum of (quantity × Selling_Price) of all Order_Lines within 1 second.
6. WHEN a Cashier removes an Order_Line, THE POS_Terminal SHALL delete only that Order_Line and SHALL recalculate the Subtotal within 1 second.
7. IF a Cashier enters a quantity that is empty, non-numeric, negative, zero, a decimal, or greater than 99, THEN THE POS_Terminal SHALL keep the previous quantity of that Order_Line unchanged and SHALL display a validation message indicating that the quantity must be a whole number from 1 to 99.
8. IF a Cashier enters a whole number from 1 to 99 that exceeds the number of servings that current Ingredient stock supports for that Dish, THEN THE POS_Terminal SHALL keep the previous quantity of that Order_Line unchanged and SHALL display a message stating the maximum supported quantity as a whole number.
9. WHEN a Cashier selects clear order and the Order contains at least one Order_Line, THE POS_Terminal SHALL remove all Order_Lines and SHALL set the Subtotal to 0.00.
10. THE POS_Terminal SHALL display a link to the Available_Menu_List on the order screen at all times.
11. IF a Cashier taps an Orderable_Dish that already exists in the Order and the resulting quantity would exceed 99 or exceed the number of servings that current Ingredient stock supports, THEN THE POS_Terminal SHALL keep the previous quantity of that Order_Line unchanged and SHALL display a message stating the maximum supported quantity as a whole number.
12. WHEN a Cashier selects the link to the Available_Menu_List, THE POS_Terminal SHALL display the Available_Menu_List and SHALL retain all current Order_Lines and the Subtotal so that they are shown unchanged when the Cashier returns to the order screen.
13. WHILE the Order contains zero Order_Lines, THE POS_Terminal SHALL display an indication that the Order is empty and SHALL display the Subtotal as 0.00.

### Requirement 6: Checkout Calculation

**User Story:** As a cashier, I want the checkout to calculate totals and change, so that I can collect payment accurately.

#### Acceptance Criteria

1. WHEN a Cashier opens the Checkout_Screen for an Order with at least one Order_Line, THE Checkout_Screen SHALL display the Subtotal, Tax_Rate (as a percentage), Tax_Amount, and Total, each monetary value with exactly 2 decimal places, within 1 second of opening.
2. WHEN a Cashier enters a valid Cash_Tendered (a non-negative monetary amount with at most 2 decimal places, from 0.00 to 999,999.99) greater than or equal to the Total, THE Checkout_Screen SHALL display Change_Due equal to Cash_Tendered minus Total with exactly 2 decimal places, within 500 milliseconds of the entry, and enable order submission.
3. IF a valid Cash_Tendered is less than the Total, THEN THE Checkout_Screen SHALL display the remaining amount due equal to Total minus Cash_Tendered with exactly 2 decimal places, not display a Change_Due value, and disable order submission.
4. IF Cash_Tendered is empty, negative, greater than 999,999.99, contains non-numeric characters, or has more than 2 decimal places, THEN THE Checkout_Screen SHALL display a validation message identifying the invalid entry, not display Change_Due or the remaining amount due, and disable order submission.
5. IF a Cashier attempts to open the Checkout_Screen for an Order with no Order_Lines, THEN THE POS_Terminal SHALL display a message that the Order is empty, not display the Checkout_Screen, and remain on the POS_Terminal with the Order unchanged.
6. THE POS_System SHALL calculate the Subtotal as the sum of all Order_Line amounts, the Tax_Amount as the Subtotal multiplied by the Tax_Rate, and the Total as the Subtotal plus the Tax_Amount, using exact decimal arithmetic with results of exactly 2 decimal places.
7. WHERE the Tax_Rate is 0 percent, THE Checkout_Screen SHALL display Tax_Amount as 0.00 and a Total equal to the Subtotal.
8. THE POS_System SHALL round the Tax_Amount to 2 decimal places using round-half-up (a value of exactly 0.005 or more in the third decimal place rounds up to the next cent) before calculating the Total.

### Requirement 7: Order Submission and Inventory Deduction

**User Story:** As a restaurant owner, I want each sale recorded and ingredient stock reduced automatically, so that records and inventory stay accurate.

#### Acceptance Criteria

1. WHEN a Cashier submits a valid Order, THE POS_System SHALL create a Transaction containing a receipt number not shared with any other Transaction in the Local_Database, the current date and time to the second in the POS_Terminal's local time zone, the handling Cashier, all Order_Lines, Subtotal, Tax_Amount, Total, Cash_Tendered, and Change_Due, with every monetary value stored to 2 decimal places. A valid Order has 1 to 100 Order_Lines, each with an integer quantity from 1 to 99, and a Cash_Tendered greater than or equal to the Total.
2. WHEN a Transaction is created, THE POS_System SHALL decrease the stock of each Ingredient by the sum, across all Order_Lines that use that Ingredient, of (Recipe_Item quantity per serving × Order_Line quantity).
3. WHEN a Transaction is created, THE POS_System SHALL record for each Order_Line the Dish name, Selling_Price, and Serving_Cost as they are at the moment of submission, and later changes to the Dish SHALL NOT alter the recorded values.
4. THE POS_System SHALL complete the Transaction creation and all Ingredient stock decreases as a single atomic operation, so that either the Transaction and every stock decrease are stored, or none of them are.
5. IF the stock of any Ingredient is less than the total quantity required by all Order_Lines in the Order at submission time, THEN THE POS_System SHALL reject the submission, create no Transaction, leave every Ingredient stock unchanged, keep the current Order unchanged in the POS_Terminal, and display the name of every Dish that cannot be fulfilled.
6. IF the Local_Database write fails during submission, THEN THE POS_System SHALL create no Transaction, leave every Ingredient stock unchanged, keep the current Order unchanged in the POS_Terminal, display no receipt, and display an error message indicating that the sale was not recorded.
7. WHEN a Transaction is created, THE POS_System SHALL display within 2 seconds of submission a receipt showing receipt number, date and time, Cashier name, Order_Lines, Subtotal, Tax_Amount, Total, Cash_Tendered, and Change_Due.
8. WHEN a Transaction is created, THE POS_Terminal SHALL start a new empty Order containing 0 Order_Lines and a new Order submission identifier once the receipt is displayed.
9. WHEN two or more Cashiers submit Orders within overlapping time, THE POS_System SHALL process the submissions one at a time in the order received, and SHALL apply criterion 5 to each later submission using the Ingredient stock remaining after the earlier submissions, so that no Ingredient stock falls below zero.
10. WHEN a submission is repeated with an Order submission identifier that already belongs to a stored Transaction, THE POS_System SHALL create no additional Transaction, make no further Ingredient stock decrease, and display the receipt of the original Transaction.
11. IF a Cashier submits an Order that is not valid under criterion 1, THEN THE POS_System SHALL reject the submission, create no Transaction, leave every Ingredient stock unchanged, keep the current Order unchanged in the POS_Terminal, and display an error message indicating which validity rule failed (no Order_Lines, Order_Line count or quantity out of range, or Cash_Tendered less than Total).

### Requirement 8: Available Menu List

**User Story:** As a cashier, I want to see which dishes can be ordered right now, so that I can tell customers accurately.

#### Acceptance Criteria

1. WHEN the Available_Menu_List is displayed, THE Available_Menu_List SHALL show every Orderable_Dish under its Category, with the Dish name and the Selling_Price shown to 2 decimal places, with Categories and the Dishes within each Category sorted alphabetically by name in ascending order, and SHALL omit every Category that contains no Orderable_Dish.
2. THE Available_Menu_List SHALL exclude every Dish whose Visibility_Flag is hidden, regardless of the Dish's Availability_Status.
3. THE Available_Menu_List SHALL exclude every Dish whose Availability_Status is unavailable, regardless of the Dish's Visibility_Flag.
4. WHEN a Transaction, Ingredient stock edit, Recipe edit, or Dish edit is saved and changes the set of Orderable_Dishes, THE Available_Menu_List SHALL reflect the change within 5 seconds of the save completing, without a manual page reload.
5. WHEN the Available_Menu_List contains no Orderable_Dishes, THE Available_Menu_List SHALL display a message indicating that no dishes are currently available, and SHALL display no Category headings.
6. WHILE a Cashier Session is active, THE Available_Menu_List SHALL be read-only, providing no control to add, edit, delete, hide, or change the price or Availability_Status of any Dish.
7. IF the Available_Menu_List fails to load or refresh, THEN THE Available_Menu_List SHALL continue to display the most recently loaded list, display an error indication that the list may be out of date, and retry the refresh every 5 seconds until it succeeds.

### Requirement 9: Ingredient Stock Manager

**User Story:** As a restaurant owner, I want to manage raw ingredients and stock levels, so that I can track what the kitchen has.

#### Acceptance Criteria

1. WHEN an Owner submits a new Ingredient with a name of 1 to 100 characters, a Unit (grams, ml, or pcs), a unit cost from 0.00 to 999,999.99 (up to 2 decimal places), and an initial stock quantity from 0 to 999,999.99 (up to 2 decimal places), THE POS_System SHALL create the Ingredient and display it in the Ingredient list.
2. WHEN an Owner submits an edit to an Ingredient with valid values, THE POS_System SHALL update the name, Unit, unit cost, and current stock quantity of that Ingredient to the submitted values and display the updated values in the Ingredient list.
3. WHEN an Owner opens the Ingredient Stock Manager, THE Ingredient Stock Manager SHALL display all Ingredients, sorted alphabetically by name, with name, Unit, unit cost, and current stock quantity for each; if no Ingredients exist, THE Ingredient Stock Manager SHALL display an empty-list message.
4. IF an Owner submits a new or edited Ingredient with a name that is empty or whitespace-only, a name longer than 100 characters, a Unit outside grams, ml, and pcs, a unit cost below 0.00 or above 999,999.99, a stock quantity below 0 or above 999,999.99, or a unit cost or stock quantity with more than 2 decimal places, THEN THE POS_System SHALL reject the submission, display a validation message identifying each invalid field, and leave stored Ingredient data unchanged.
5. IF an Owner submits a new or edited Ingredient whose name matches, ignoring letter case and leading and trailing whitespace, the name of a different existing Ingredient, THEN THE POS_System SHALL reject the submission, display a duplicate-name message, and leave stored Ingredient data unchanged.
6. WHEN an Owner deletes an Ingredient that no Recipe references, THE POS_System SHALL delete the Ingredient and remove it from the Ingredient list.
7. IF an Owner deletes an Ingredient that one or more Recipes reference, THEN THE POS_System SHALL reject the deletion, keep the Ingredient unchanged, and display the names of all Dishes whose Recipes reference the Ingredient.
8. WHEN an Owner changes the unit cost of an Ingredient, THE POS_System SHALL keep the Serving_Cost recorded on all Transactions created before the change unchanged, and SHALL use the new unit cost only for Transactions created after the change.
9. IF the Unit of an Ingredient is pcs and an Owner submits a stock quantity or a Recipe_Item quantity for that Ingredient that is not a whole number, THEN THE POS_System SHALL reject the submission, display a validation message indicating that whole numbers are required, and leave stored data unchanged.
10. IF the POS_System fails to save a create, edit, or delete of an Ingredient, THEN THE POS_System SHALL display an error message indicating the operation failed and leave the stored Ingredient data as it was before the operation.

### Requirement 10: Recipe and Pricing Linker

**User Story:** As a restaurant owner, I want to define each dish's price, target cost, and ingredient quantities, so that stock usage and margins are tracked.

#### Acceptance Criteria

1. WHEN an Owner saves a Dish with a name of 1 to 100 characters, a Category, a Selling_Price from 0.01 to 999,999.99, and a Target_Cost from 0.00 to 999,999.99 (both with at most 2 decimal places), THE POS_System SHALL store those values and display the saved Dish within 1 second.
2. WHEN an Owner adds a Recipe_Item to a Dish by choosing an Ingredient and entering a quantity per serving greater than 0 and at most 999,999.999 (at most 3 decimal places, expressed in the Ingredient's unit), THE POS_System SHALL store the Recipe_Item and display it in the Dish's Recipe within 1 second.
3. WHEN an Owner edits a Recipe_Item quantity to a valid value, THE POS_System SHALL update that Recipe_Item in the Recipe of that Dish and display the updated quantity within 1 second.
4. WHEN an Owner removes a Recipe_Item from a Dish, THE POS_System SHALL delete that Recipe_Item from the Recipe of that Dish and remove it from the displayed Recipe within 1 second.
5. WHEN a Recipe changes or the Dish's Selling_Price or Target_Cost changes, THE Recipe and Pricing Linker SHALL display, within 1 second, the Serving_Cost of the Dish (the sum of each Recipe_Item quantity multiplied by its Ingredient unit cost, rounded to 2 decimal places) and the difference between Serving_Cost and Target_Cost (Serving_Cost minus Target_Cost, rounded to 2 decimal places, with a minus sign shown for negative values).
6. WHEN an Ingredient unit cost changes, THE Recipe and Pricing Linker SHALL recalculate and display the Serving_Cost and the Serving_Cost-to-Target_Cost difference of every Dish whose Recipe contains that Ingredient within 2 seconds.
7. IF an Owner enters a Dish name that is empty or longer than 100 characters, no Category, a Selling_Price less than 0.01 or greater than 999,999.99, or a Target_Cost less than 0.00 or greater than 999,999.99, THEN THE POS_System SHALL reject the entry, display a validation message identifying the invalid field, and keep the previously stored Dish values unchanged.
8. IF an Owner enters a Recipe_Item quantity that is less than or equal to 0, greater than 999,999.999, or non-numeric, THEN THE POS_System SHALL reject the entry, display a validation message indicating the allowed quantity range, and keep the previously stored Recipe unchanged.
9. IF an Owner adds an Ingredient to a Recipe that already contains that Ingredient, THEN THE POS_System SHALL reject the second entry, display a duplicate-ingredient message, and keep the existing Recipe_Item unchanged.
10. WHILE the Serving_Cost of a Dish is greater than its Selling_Price, THE Recipe and Pricing Linker SHALL display a negative-margin warning for that Dish, and SHALL remove the warning within 1 second after Serving_Cost becomes less than or equal to Selling_Price.
11. IF an Owner attempts to add a Recipe_Item to a Recipe that already contains 50 Recipe_Items, THEN THE POS_System SHALL reject the entry, display a message stating the 50-item limit, and keep the existing Recipe unchanged.
12. IF storing a Dish or Recipe_Item fails, THEN THE POS_System SHALL display an error message indicating the save failed and SHALL retain the previously stored data without partial changes.

### Requirement 11: Automatic Dish Availability

**User Story:** As a restaurant owner, I want dishes to become unavailable automatically when ingredients run short, so that cashiers never sell what the kitchen cannot make.

#### Acceptance Criteria

1. IF the Dish Recipe contains at least one Recipe_Item AND the stock of any Ingredient in the Recipe is less than the corresponding Recipe_Item quantity per serving (including stock of zero or a negative value), THEN THE POS_System SHALL set the Availability_Status of the Dish to unavailable.
2. WHEN the Dish Recipe contains at least one Recipe_Item AND the stock of every Ingredient in the Recipe is greater than or equal to the corresponding Recipe_Item quantity per serving, THE POS_System SHALL set the Availability_Status of the Dish to available.
3. WHEN Ingredient stock changes through a Transaction or an Owner edit, THE POS_System SHALL recompute the Availability_Status of every Dish whose Recipe references that Ingredient within 1 second of the stock change being saved.
4. WHEN a Recipe changes by adding, removing, or modifying a Recipe_Item or its quantity per serving, THE POS_System SHALL recompute the Availability_Status of that Dish within 1 second of the Recipe change being saved.
5. IF a Dish has a Recipe with no Recipe_Items, THEN THE POS_System SHALL set the Availability_Status of the Dish to unavailable.
6. WHILE a Dish has Availability_Status unavailable, THE POS_Terminal SHALL display the Dish with a visible unavailable label and reject any attempt to add the Dish to an Order, leaving the Order contents unchanged.
7. WHILE a Dish has Availability_Status unavailable, THE Menu Management screen SHALL display an out-of-stock indicator for the Dish.
8. WHEN the Availability_Status of a Dish changes, THE POS_Terminal and THE Menu Management screen SHALL show the updated status within 2 seconds, without requiring the user to reload the screen.
9. IF the recomputation of a Dish Availability_Status fails, THEN THE POS_System SHALL set the Availability_Status of that Dish to unavailable, retain all Ingredient stock and Recipe data unchanged, and display an error message indicating that availability could not be updated.

### Requirement 12: Category Management

**User Story:** As a restaurant owner, I want to create, view, update, and delete categories, so that the menu is organized.

#### Acceptance Criteria

1. WHEN an Owner submits a Category name that, after removing leading and trailing whitespace, is 1 to 50 characters long and does not match any existing Category name (case-insensitive comparison), THE POS_System SHALL create the Category with the trimmed name and display it on the Menu Management screen within 2 seconds.
2. WHEN an Owner opens the Menu Management screen, THE POS_System SHALL display every Category with its name and the number of Dishes assigned to it (0 or more), and SHALL update the displayed Dish count within 2 seconds after a Dish is added to or removed from that Category.
3. WHEN an Owner edits the name of a Category to a value that, after removing leading and trailing whitespace, is 1 to 50 characters long and does not match the name of any other Category (case-insensitive comparison), THE POS_System SHALL update the Category name and display the updated name on the Menu Management screen within 2 seconds, while keeping all Dishes assigned to that Category.
4. WHEN an Owner deletes a Category that contains 0 Dishes, THE POS_System SHALL delete the Category and remove it from the Menu Management screen within 2 seconds.
5. IF an Owner deletes a Category that contains 1 or more Dishes, THEN THE POS_System SHALL reject the deletion, keep the Category and all its Dishes unchanged, and display a message stating the number of Dishes in the Category.
6. IF an Owner submits a Category name for creation or editing that is empty, consists only of whitespace, is longer than 50 characters after trimming, or matches the name of another existing Category (case-insensitive comparison), THEN THE POS_System SHALL reject the submission, keep existing Category data unchanged, and display a validation message that identifies which rule was violated (empty, too long, or duplicate).
7. IF a create, edit, or delete operation on a Category fails because of a system error, THEN THE POS_System SHALL keep existing Category and Dish data unchanged and display an error message indicating that the operation failed and can be retried.

### Requirement 13: Dish Management

**User Story:** As a restaurant owner, I want to create, view, update, and delete dishes and control their visibility and price, so that the menu stays current.

#### Acceptance Criteria

1. WHEN an Owner submits a Dish with a name of 1 to 100 characters, an existing Category, and a Selling_Price from 0.01 to 999,999.99 with at most 2 decimal places, THE POS_System SHALL create the Dish with Visibility_Flag visible and display the Dish on the Menu Management screen within 2 seconds.
2. WHEN an Owner opens the Menu Management screen, THE POS_System SHALL display all Dishes, including Dishes with Visibility_Flag hidden, each with its name, Category, Selling_Price, Visibility_Flag, and Availability_Status, within 2 seconds for up to 500 Dishes.
3. WHEN an Owner submits an edit to the name, Category, or Selling_Price of a Dish and the submitted values satisfy the validation rules in criterion 6, THE POS_System SHALL update the Dish and display the updated values on the Menu Management screen within 2 seconds.
4. WHEN an Owner toggles the Visibility_Flag of a Dish, THE POS_System SHALL store the new value and display the new Visibility_Flag value for that Dish on the Menu Management screen within 2 seconds.
5. WHEN an Owner confirms the deletion of a Dish, THE POS_System SHALL remove the Dish and its Recipe from the menu and from the Menu Management screen, and SHALL leave the name, Selling_Price, and quantity stored on the Order_Line records of past Transactions unchanged.
6. IF an Owner submits a new or edited Dish with a name that is empty or contains only whitespace, a name longer than 100 characters, a missing or non-existent Category, or a Selling_Price that is non-numeric, less than or equal to zero, greater than 999,999.99, or has more than 2 decimal places, THEN THE POS_System SHALL reject the submission, display a validation message identifying each invalid field, and leave stored Dish data unchanged.
7. WHEN an Owner changes the Selling_Price of a Dish, THE POS_System SHALL leave the Selling_Price stored on every existing Transaction unchanged.
8. WHEN an Owner requests deletion of a Dish, THE POS_System SHALL display a confirmation prompt naming the Dish and SHALL NOT remove or change any Dish, Recipe, or Order_Line data until the Owner confirms.
9. IF an Owner cancels the deletion confirmation prompt, THEN THE POS_System SHALL close the prompt and keep the Dish, its Recipe, and all Order_Line records unchanged.
10. IF storing a create, edit, Visibility_Flag change, or deletion of a Dish fails, THEN THE POS_System SHALL display an error message indicating the operation did not complete and SHALL leave stored Dish and Recipe data as it was before the operation.

### Requirement 14: Tax Configuration

**User Story:** As a restaurant owner, I want to set the tax rate, so that checkout totals reflect applicable taxes.

#### Acceptance Criteria

1. WHEN an Owner saves a Tax_Rate that is a number between 0 and 100 percent inclusive with at most 2 decimal places, THE POS_System SHALL store the Tax_Rate as the current Tax_Rate, replace any previously stored Tax_Rate, retain it across POS_System restarts, and display a confirmation that the save succeeded.
2. IF an Owner enters a Tax_Rate that is empty, non-numeric, less than 0 percent, greater than 100 percent, or has more than 2 decimal places, THEN THE POS_System SHALL reject the entry, display a validation message indicating which rule was violated, and keep the previously stored Tax_Rate unchanged.
3. WHEN an Owner changes the Tax_Rate, THE POS_System SHALL keep the Tax_Rate and Tax_Amount recorded on every Transaction completed before the change unchanged.
4. WHEN a Cashier opens the Checkout_Screen, THE Checkout_Screen SHALL calculate the Tax_Amount using the Tax_Rate stored at the moment the Checkout_Screen is opened, rounded to 2 decimal places.
5. WHILE a Checkout_Screen is open, THE Checkout_Screen SHALL continue to apply the Tax_Rate that was stored when it was opened, even if an Owner saves a different Tax_Rate during that time.
6. IF no Tax_Rate has been stored when a Cashier opens the Checkout_Screen, THEN THE Checkout_Screen SHALL apply a Tax_Rate of 0 percent.
7. IF a user whose role is not Owner attempts to change the Tax_Rate, THEN THE POS_System SHALL reject the change, display a message indicating the user lacks permission, and keep the stored Tax_Rate unchanged.

### Requirement 15: Dashboard Financial Overview

**User Story:** As a restaurant owner, I want gross sales and net revenue cards, so that I can see how the business is performing.

#### Acceptance Criteria

1. WHEN an Owner opens the Dashboard, THE Dashboard SHALL display a Gross_Sales card and a Net_Revenue card for the Today Date_Filter within 2 seconds, with each value shown as a decimal number with exactly 2 decimal places (rounded half up).
2. WHEN an Owner selects a Date_Filter (Today, Past 7 Days, or Past 30 Days), THE Dashboard SHALL recalculate the Gross_Sales card and the Net_Revenue card within 2 seconds, including only Transactions whose recorded sale timestamp falls within the selected Date_Filter range, inclusive of the range start and end.
3. THE Dashboard SHALL calculate Net_Revenue as Gross_Sales minus the sum of (Serving_Cost × quantity) across every Order_Line in the Transactions included in the selected Date_Filter, using the Serving_Cost recorded on each Order_Line at the time of sale, regardless of any later change to the menu item's current Serving_Cost.
4. WHEN no Transactions exist in the selected Date_Filter, THE Dashboard SHALL display Gross_Sales and Net_Revenue as 0.00.
5. THE Dashboard SHALL define Today as the current local calendar day from 00:00:00.000 to 23:59:59.999 local time, Past 7 Days as the current local day and the 6 preceding local days (7 calendar days in total), and Past 30 Days as the current local day and the 29 preceding local days (30 calendar days in total).
6. THE Dashboard SHALL calculate Gross_Sales as the sum of (selling price × quantity) across every Order_Line in the Transactions included in the selected Date_Filter.
7. IF the Gross_Sales or Net_Revenue calculation fails or the Transaction data cannot be retrieved, THEN THE Dashboard SHALL display an error indication on both cards, SHALL NOT display 0.00 or a stale value in place of the failed result, and SHALL retain the currently selected Date_Filter so the Owner can retry by reselecting it.

### Requirement 16: Top-Selling Dishes

**User Story:** As a restaurant owner, I want to see my best-selling dishes, so that I can make stocking and menu decisions.

#### Acceptance Criteria

1. WHEN the Dashboard is displayed with a selected Date_Filter, THE Dashboard SHALL display up to 5 Dishes ranked in descending order by units sold, where units sold is the sum of the quantities of that Dish across all Transactions within the selected Date_Filter, and SHALL display all Dishes with at least 1 unit sold if fewer than 5 such Dishes exist.
2. WHEN the Dashboard displays a ranked Dish, THE Dashboard SHALL display the Dish's rank position (1 to 5), recorded name, units sold as a whole number, and revenue generated as the sum of line totals for that Dish within the selected Date_Filter, in the system currency with 2 decimal places.
3. IF two Dishes have equal units sold, THEN THE Dashboard SHALL rank the Dish with higher revenue first, and IF revenue is also equal, THEN THE Dashboard SHALL rank the Dish whose recorded name comes first in ascending case-insensitive alphabetical order first.
4. WHEN the Dashboard displays the ranked Dishes, THE Dashboard SHALL label the Dish at rank 1 with the text "Top-Selling Dish" and SHALL NOT apply that label to any other Dish.
5. WHEN the Date_Filter is changed, THE Dashboard SHALL update the ranked Dishes to reflect the newly selected Date_Filter within 2 seconds.
6. IF no Transactions exist in the selected Date_Filter, THEN THE Dashboard SHALL display a message indicating that no sales data is available for the selected period and SHALL NOT display any ranked Dish rows or Top-Selling Dish label.
7. IF a Dish has been deleted, THEN THE Dashboard SHALL continue to include that Dish in rankings, units sold, and revenue for Transactions within the selected Date_Filter, using the name recorded on those Transactions.

### Requirement 17: Sales Over Time Chart

**User Story:** As a restaurant owner, I want a chart of sales over time, so that I can see trends.

#### Acceptance Criteria

1. WHEN the Dashboard loads or an Owner selects a Date_Filter other than Today, THE Dashboard SHALL display a line or bar chart with one data point per local calendar day in the selected Date_Filter, where each data point equals the sum of Gross_Sales for Transactions dated on that local calendar day, displayed with 2 decimal places.
2. WHEN the Dashboard loads or an Owner selects the Today Date_Filter, THE Dashboard SHALL display the chart with 24 data points, one per local clock hour (00:00 to 23:59), where each data point equals the sum of Gross_Sales for Transactions dated within that local hour, displayed with 2 decimal places.
3. WHEN an Owner selects a different Date_Filter, THE Dashboard SHALL redraw the chart for the selected Date_Filter within 2 seconds of the selection.
4. WHEN the chart is displayed, THE Dashboard SHALL display a value of 0.00 for each day or hour in the selected Date_Filter that has no Transactions.
5. WHEN the chart is displayed, THE Dashboard SHALL display chart data point values whose sum equals the Gross_Sales shown on the Gross_Sales card for the same Date_Filter, with a difference of 0.00.
6. WHEN the chart is displayed, THE Dashboard SHALL label the horizontal axis with the time period (day or hour) and the vertical axis with the currency amount, including the currency symbol or code.
7. IF the chart data cannot be retrieved for the selected Date_Filter, THEN THE Dashboard SHALL display an error message indicating that the chart failed to load, SHALL NOT display partial or stale chart values, and SHALL keep the selected Date_Filter unchanged.

### Requirement 18: Transaction Log

**User Story:** As a restaurant owner, I want to search and filter past receipts, so that I can audit sales and cashier activity.

#### Acceptance Criteria

1. THE Transaction_Log SHALL display for each Transaction the receipt number, date and time (to the minute, in the device's local time zone), Total (with two decimal places), and handling Cashier name.
2. THE Transaction_Log SHALL order Transactions by date and time with the most recent first, and SHALL order Transactions with identical date and time by receipt number in descending order.
3. WHEN an Owner enters search text of 1 to 50 characters, THE Transaction_Log SHALL display only Transactions whose receipt number contains the search text, ignoring letter case, and SHALL display all Transactions that satisfy the other applied filters when the search text is empty.
4. WHEN an Owner selects a Cashier filter, THE Transaction_Log SHALL display only Transactions handled by the selected Cashier, and WHEN an Owner selects the "All Cashiers" option, THE Transaction_Log SHALL apply no Cashier restriction.
5. WHEN an Owner selects a Date_Filter or a custom start date and end date, THE Transaction_Log SHALL display only Transactions whose date and time fall within that period, where a custom period includes the start date from 00:00:00 through the end date at 23:59:59 in local time.
6. WHEN an Owner applies several filters together, THE Transaction_Log SHALL display only Transactions that satisfy all applied filters.
7. WHEN an Owner selects a Transaction, THE Transaction_Log SHALL display the Order_Lines, Subtotal, Tax_Amount, Total, Cash_Tendered, and Change_Due of that Transaction.
8. WHEN no Transaction matches the applied filters, THE Transaction_Log SHALL display a message that no transactions were found and SHALL display no Transaction rows or page controls.
9. WHEN the Transaction_Log contains more than 25 matching Transactions, THE Transaction_Log SHALL display them in pages of 25 rows, with the final page showing the remaining rows (1 to 25), and SHALL provide controls to move to the previous page, the next page, and to a specific page number.
10. IF an Owner enters a custom end date earlier than the custom start date, THEN THE Transaction_Log SHALL display a validation message indicating that the end date must not be earlier than the start date, keep the previously displayed results, and keep the previously applied filters unchanged.
11. WHEN an Owner changes the search text, Cashier filter, Date_Filter, or a valid custom date range, THE Transaction_Log SHALL display the first page of updated results within 2 seconds for up to 10,000 stored Transactions.

### Requirement 19: Code Organization and Documentation

**User Story:** As a developer, I want clean modular code with setup instructions, so that the system is easy to maintain and run.

#### Acceptance Criteria

1. THE POS_System SHALL organize source code into six separate modules (authentication, POS terminal, inventory and recipes, menu management, dashboard, and database access), with each module contained in its own distinct source directory and no source file belonging to more than one module.
2. WHEN a developer runs the single documented initialization command on a machine with no existing Local_Database, THE POS_System SHALL create the Local_Database with all required tables and exit with status code 0 within 30 seconds.
3. WHEN a developer runs the single documented seed command against an initialized Local_Database, THE POS_System SHALL load the Seed_Data and exit with status code 0 within 30 seconds, and running the command a second time SHALL leave the record count of every seeded table unchanged.
4. IF the initialization command or the seed command fails (including running the seed command before the Local_Database is initialized), THEN THE POS_System SHALL exit with a non-zero status code, display an error message identifying which command failed and the cause, and leave the Local_Database without partially loaded Seed_Data.
5. THE POS_System SHALL provide project documentation that lists the prerequisites with required versions, numbered setup steps, the startup command, and, for every seeded account, its username, password, and role.
6. THE POS_System SHALL include automated tests, runnable with a single documented command that exits with status code 0 when all tests pass and a non-zero status code when any test fails, covering permission enforcement, checkout calculation, inventory deduction, and availability computation, with at least one passing-path case and one rejection or boundary case (such as denied access, zero stock, or insufficient stock) for each of the four areas.
