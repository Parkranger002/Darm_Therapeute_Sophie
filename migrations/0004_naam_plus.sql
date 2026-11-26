-- Productnaam Darmmanagement PRO wordt Darmmanagement PLUS (nov. 2026).
-- SKU's en de interne lijn 'pro' blijven gelijk, zodat bestaande bestellingen blijven kloppen.
UPDATE producten SET naam = 'Darmmanagement PLUS' WHERE naam = 'Darmmanagement PRO';
