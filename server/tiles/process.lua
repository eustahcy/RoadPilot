-- RoadPilot — kafelki wektorowe z OpenStreetMap (tilemaker ≥ 3.0). Minimalny zestaw warstw pod własny styl mapy
-- w HUD: woda, użytkowanie terenu, drogi (z ograniczeniami dla ciężarówek), kolej, budynki, miejscowości.
-- Ograniczenia zostają w atrybutach dróg — aplikacja porównuje je z pojazdem i rysuje zakazy na czerwono.

node_keys = { "place" }
way_keys = { "highway", "waterway", "natural", "landuse", "building", "railway", "leisure" }

local PLACE_ZOOM = { city = 6, town = 9, village = 12, hamlet = 14 }

function node_function()
  local place = Find("place")
  local z = PLACE_ZOOM[place]
  if z and Find("name") ~= "" then
    Layer("place", false)
    Attribute("name", Find("name"))
    Attribute("class", place)
    MinZoom(z)
  end
end

-- Klasa drogi → nazwa w stylu i minimalny zoom.
local ROAD = {
  motorway = { "motorway", 6 }, motorway_link = { "motorway", 10 },
  trunk = { "trunk", 7 }, trunk_link = { "trunk", 10 },
  primary = { "primary", 8 }, primary_link = { "primary", 11 },
  secondary = { "secondary", 10 }, secondary_link = { "secondary", 12 },
  tertiary = { "tertiary", 11 }, tertiary_link = { "tertiary", 12 },
  residential = { "minor", 13 }, unclassified = { "minor", 13 }, living_street = { "minor", 14 },
  service = { "service", 14 },
}
-- Tagi ograniczeń kopiowane 1:1 — parsowanie po stronie aplikacji (jak w server/osm.mjs).
local LIMITS = { "maxheight", "maxweight", "maxweightrating", "maxaxleload", "maxwidth", "maxlength", "hgv", "maxspeed:hgv" }

function way_function()
  local highway = Find("highway")
  if highway ~= "" then
    local r = ROAD[highway]
    if r then
      Layer("road", false)
      Attribute("class", r[1])
      MinZoom(r[2])
      if Find("name") ~= "" then Attribute("name", Find("name")) end
      if Find("ref") ~= "" then Attribute("ref", Find("ref")) end
      if Find("oneway") == "yes" then AttributeNumeric("oneway", 1) end
      if Find("tunnel") == "yes" then AttributeNumeric("tunnel", 1) end
      if Find("bridge") == "yes" then AttributeNumeric("bridge", 1) end
      for _, k in ipairs(LIMITS) do
        local v = Find(k)
        if v ~= "" then Attribute(k, v) end
      end
    end
    return
  end

  local railway = Find("railway")
  if railway == "rail" then
    Layer("railway", false)
    MinZoom(10)
    return
  end

  local waterway = Find("waterway")
  if waterway == "river" or waterway == "canal" then
    Layer("waterway", false)
    Attribute("class", waterway)
    MinZoom(9)
    return
  elseif waterway == "stream" then
    Layer("waterway", false)
    Attribute("class", "stream")
    MinZoom(13)
    return
  end

  local natural = Find("natural")
  local landuse = Find("landuse")
  local leisure = Find("leisure")
  if natural == "water" or landuse == "reservoir" or landuse == "basin" then
    Layer("water", true)
    MinZoom(Area() > 500000 and 6 or 10)
    return
  end
  if natural == "wood" or landuse == "forest" then
    Layer("landuse", true); Attribute("class", "wood"); MinZoom(Area() > 2000000 and 7 or 10); return
  end
  if landuse == "residential" or landuse == "retail" or landuse == "commercial" then
    Layer("landuse", true); Attribute("class", "residential"); MinZoom(10); return
  end
  if landuse == "industrial" or landuse == "railway" then
    Layer("landuse", true); Attribute("class", "industrial"); MinZoom(11); return
  end
  if landuse == "farmland" or landuse == "meadow" or landuse == "grass" or natural == "grassland" or leisure == "park" then
    Layer("landuse", true); Attribute("class", "grass"); MinZoom(11); return
  end
  if Find("building") ~= "" then
    Layer("building", true)
    MinZoom(14)
  end
end
