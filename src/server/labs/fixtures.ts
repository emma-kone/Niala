// Jeux de données d'exemple du laboratoire SQL libre (aucune donnée personnelle).
/** Schémas d'exemple du laboratoire SQL libre. */
export const SQL_FIXTURES: Record<string, { label: string; description: string; setupSql: string }> = {
  bibliotheque: {
    label: "Bibliothèque",
    description: "Livres, adhérents, emprunts (jointures, agrégats).",
    setupSql: `CREATE TABLE livres (id INTEGER PRIMARY KEY, titre TEXT NOT NULL, auteur TEXT NOT NULL, annee INTEGER, categorie TEXT);
CREATE TABLE adherents (id INTEGER PRIMARY KEY, nom TEXT NOT NULL, ville TEXT, inscrit_le DATE);
CREATE TABLE emprunts (id INTEGER PRIMARY KEY, livre_id INTEGER NOT NULL REFERENCES livres(id), adherent_id INTEGER NOT NULL REFERENCES adherents(id), date_emprunt DATE NOT NULL, date_retour DATE);
INSERT INTO livres (titre, auteur, annee, categorie) VALUES
 ('Structures de données en Java', 'R. Lafore', 2003, 'Informatique'),
 ('Le mythe du programmeur', 'F. Brooks', 1975, 'Génie logiciel'),
 ('Bases de données : principes', 'C. Date', 2004, 'Informatique'),
 ('Clean Code', 'R. Martin', 2008, 'Génie logiciel'),
 ('Réseaux et télécoms', 'A. Tanenbaum', 2011, 'Réseaux');
INSERT INTO adherents (nom, ville, inscrit_le) VALUES
 ('Alice Martin', 'Paris', '2024-09-01'), ('Karim Benali', 'Lyon', '2024-10-15'),
 ('Julie Dufour', 'Paris', '2025-01-20'), ('Marc Lefevre', 'Nantes', '2025-02-03');
INSERT INTO emprunts (livre_id, adherent_id, date_emprunt, date_retour) VALUES
 (1, 1, '2025-03-01', '2025-03-15'), (1, 2, '2025-04-02', NULL),
 (3, 1, '2025-04-10', '2025-05-01'), (4, 3, '2025-05-05', NULL),
 (5, 4, '2025-05-12', '2025-06-01');`,
  },
  entreprise: {
    label: "Entreprise (RH)",
    description: "Employés, services, salaires (GROUP BY, HAVING).",
    setupSql: `CREATE TABLE services (id INTEGER PRIMARY KEY, nom TEXT NOT NULL, ville TEXT);
CREATE TABLE employes (id INTEGER PRIMARY KEY, nom TEXT NOT NULL, service_id INTEGER REFERENCES services(id), salaire REAL NOT NULL, embauche DATE);
INSERT INTO services (nom, ville) VALUES ('Développement', 'Paris'), ('Réseaux', 'Lyon'), ('Support', 'Paris'), ('Direction', 'Nantes');
INSERT INTO employes (nom, service_id, salaire, embauche) VALUES
 ('Sophie Durand', 1, 3200, '2019-03-01'), ('Paul Moreau', 1, 2900, '2021-06-15'),
 ('Nadia Cherif', 2, 3100, '2020-01-10'), ('Luc Petit', 2, 2600, '2022-09-01'),
 ('Emma Rousseau', 3, 2400, '2023-02-20'), ('Hugo Bernard', 4, 4500, '2015-11-05');`,
  },
  boutique: {
    label: "Boutique en ligne",
    description: "Clients, commandes, lignes (jointures multiples, totaux).",
    setupSql: `CREATE TABLE clients (id INTEGER PRIMARY KEY, nom TEXT NOT NULL, email TEXT UNIQUE);
CREATE TABLE produits (id INTEGER PRIMARY KEY, libelle TEXT NOT NULL, prix REAL NOT NULL, stock INTEGER DEFAULT 0);
CREATE TABLE commandes (id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), date_cmd DATE NOT NULL);
CREATE TABLE lignes (commande_id INTEGER NOT NULL REFERENCES commandes(id), produit_id INTEGER NOT NULL REFERENCES produits(id), quantite INTEGER NOT NULL, PRIMARY KEY (commande_id, produit_id));
INSERT INTO clients (nom, email) VALUES ('Alice', 'alice@mail.fr'), ('Karim', 'karim@mail.fr'), ('Julie', 'julie@mail.fr');
INSERT INTO produits (libelle, prix, stock) VALUES ('Clavier mécanique', 89.9, 12), ('Souris sans fil', 29.9, 40), ('Écran 27"', 219, 7), ('Casque audio', 79, 15);
INSERT INTO commandes (client_id, date_cmd) VALUES (1, '2025-04-01'), (1, '2025-05-10'), (2, '2025-04-15'), (3, '2025-05-20');
INSERT INTO lignes VALUES (1, 1, 1), (1, 2, 2), (2, 3, 1), (3, 2, 1), (3, 4, 1), (4, 3, 2);`,
  },
  vide: {
    label: "Base vide",
    description: "Environnement vierge pour exercices de création.",
    setupSql: `SELECT 1;`,
  },
};
