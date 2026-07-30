# The Advanced Search Cheat Sheet

Here is a guide on how you can now search your local database:

## Boolean Operators

You can combine terms using standard logic:

* **AND**: `crypto AND btc` (Implicit AND also works: `crypto btc`)
* **OR**: `crypto OR stock`
* **NOT**: `NOT scam` or `!scam`
* **Parentheses**: `(crypto OR btc) AND NOT (scam OR "buy now")`

## Exact Strings

Enclose multi-word phrases in double quotes to search for that exact sequence:

* `"free shipping"`
* `"looking for recommendations"`

## Field Targeting

Restrict your search to specific parts of a post using `field:` prefixes (supported fields are `author`, `group`, and `text`):

* `author:"John Doe"` (Only posts written by John Doe)
* `group:"Local Marketplace"` (Only posts in this specific group)
* `text:urgent` (Forces the word to be found in the body text, ignoring author names)

## Regular Expressions (Regex)

Enclose your pattern in forward slashes. You can use standard JavaScript regex flags (like `i` for case-insensitive, or `g`):

* `/b[aeiou]y/i` (Matches "buy", "bay", "boy", etc.)
* `/^\s*hiring/i` (Matches posts that start with the word "hiring")
* `text:/^Looking for/` AND `author:/smith/i` (Combines Regex with Field Targeting and Boolean logic)
