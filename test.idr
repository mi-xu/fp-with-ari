data Bool : Type where
  True : Bool
  False : Bool

data Nat : Type where
  Z : Nat
  S : Nat -> Nat

data List : Type -> Type where
  Nil : List a
  Cons : a -> List a -> List a

plus : Nat -> Nat -> Nat
plus Z n = n
plus (S k) n = S (plus k n)

data Equality : .{T: Type} -> T -> T -> Type where
  Refl : .{T: Type} -> (a: T) -> Equality T a a

a : Nat
a = Z

b : Nat
b = S Z

c : Nat
c = plus a b

-- x : Equality Nat Nat
-- x = Refl a a