/*
1.
  traverse: (Traversable t, Applicative f) => (a -> f b) -> t a -> f (t b)

In traverse fill in t and f with a few different examples and think through what it does.
  Goal: really digest the ideal of "monoidally combining" the contexts.

Traversables
- List
- Maybe
- Either
- Tree
- Map

Applicatives
- List
- Maybe
- Promise
- Const
- Stream

t = List
(a -> List b) -> List a -> List (List b)          f = List
(a -> Maybe b) -> List a -> Maybe (List b)        f = Maybe
takes a function that turns a to maybe b, and a list of a
combines each maybe into a list of maybes
(a -> Promise b) -> List a -> Promise (List b)    f = Promise
(a -> Const b) -> List a -> Const (List b)        f = Const
(a -> Stream b) -> List a -> Stream (List b)      f = Stream

t = Maybe
(a -> List b) -> Maybe a -> List (Maybe b)          f = List
(a -> Maybe b) -> Maybe a -> Maybe (Maybe b)        f = Maybe
(a -> Promise b) -> Maybe a -> Promise (Maybe b)    f = Promise
(a -> Const b) -> Maybe a -> Const (Maybe b)        f = Const
(a -> Stream b) -> Maybe a -> Stream (Maybe b)      f = Stream

t = Either
(a -> List b) -> Either a -> List (Either b)          f = List
(a -> Maybe b) -> Either a -> Maybe (Either b)        f = Maybe
(a -> Promise b) -> Either a -> Promise (Either b)    f = Promise
(a -> Const b) -> Either a -> Const (Either b)        f = Const
(a -> Stream b) -> Either a -> Stream (Either b)      f = Stream

t = Tree
(a -> List b) -> Tree a -> List (Tree b)          f = List
(a -> Maybe b) -> Tree a -> Maybe (Tree b)        f = Maybe
(a -> Promise b) -> Tree a -> Promise (Tree b)    f = Promise
(a -> Const b) -> Tree a -> Const (Tree b)        f = Const
(a -> Stream b) -> Tree a -> Stream (Tree b)      f = Stream

t = Map
(a -> List b) -> Map a -> List (Map b)          f = List
(a -> Maybe b) -> Map a -> Maybe (Map b)        f = Maybe
(a -> Promise b) -> Map a -> Promise (Map b)    f = Promise
(a -> Const b) -> Map a -> Const (Map b)        f = Const
(a -> Stream b) -> Map a -> Stream (Map b)      f = Stream
*/

/*
2. Consider:
  getChar : IO Char

  Now imagine you want to get 5 chars from the user. Can you model that with traverse?
    It's ok if you use words instead of code. Goal: understand how traverse relates to this.

  Hint: what is the type of the next expression:
    [getChar, getChar, getChar, getChar, getChar]
*/

/*
3. Think or prove if all traversables are foldable? meaning can you get foldMap from traverse? Or not?
*/
