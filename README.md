# Zdrowie Taty

Strona na telefon: codzienne pomiary cukru i ciśnienia, wykaz leków, magazyn tabletek i alarm o zamówieniu.
Jeden plik `index.html` + Firebase (Firestore i logowanie) + GitHub Pages, jak w Butli.

## Dane w Firestore

| Kolekcja | Pola |
|---|---|
| `cukier` | `wartosc`, `kiedy` |
| `cisnienie` | `gorne`, `dolne`, `puls`, `kiedy` |
| `leki` | `nazwa`, `dawki` (5 pór: przed śniadaniem, po śniadaniu, po obiedzie, po kolacji, na noc), `naDzien` (suma dawek), `stan`, `stanData` |
| `ustawienia/alarm` | `prog` (dni), `sprawdzono` i `wyslano` (zapisuje skrypt maila) |

Dostęp ma tylko konto `guldorf@tata.app` (`firestore.rules`). Hasła nie ma w kodzie: pierwsze logowanie na stronie zakłada konto.

## Jak liczone są leki

`stan` to liczba tabletek w dniu `stanData`, rano, przed dzisiejszą dawką. Każdy kolejny dzień odejmuje `naDzien`.
Zmiana dawki najpierw przelicza stan po starej dawce, a nowa obowiązuje od dziś.
Alarm włącza się, gdy leku zostaje na `prog` dni lub mniej.

## Mail

`alarm-mail.gs` działa w Google Apps Script na koncie właściciela, codziennie około 8:00, i wysyła maila na to konto.
Pierwszy mail idzie po przekroczeniu progu (domyślnie 10 dni), potem co 3 dni, dopóki stan leku nie zostanie uzupełniony.
Mail wymienia leki do zamówienia i te, które skończą się niedługo (do 2 x próg), oraz pokazuje słupki z zapasem wszystkich leków.
Funkcja `wyslijProbny` wysyła taki mail od razu, żeby zobaczyć, jak wygląda.
Strona pokazuje w Magazynie, kiedy skrypt ostatnio sprawdzał leki.

Instalacja: nowy projekt na script.google.com, wklej plik, wpisz `HASLO`, wybierz funkcję `zainstaluj`, Uruchom, zezwól na dostęp.
Hasło wpisuje się tylko w kopii na script.google.com, nigdy w tym repozytorium.
