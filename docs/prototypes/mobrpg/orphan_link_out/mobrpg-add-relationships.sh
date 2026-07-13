#!/usr/bin/env bash
# mobRPG API calls to mirror the vault auto-links into the Space world.
# READ-ONLY access here — Tim (owner) must run these. Each link = a Generic
# event join with two Link participants (mobRPG models relationships as events).
BASE=https://www.mobrpg.com/api
W=a254e424-6a9e-493c-aa8e-4e76e4824fc2
: "${MOBRPG_TOKEN:?set MOBRPG_TOKEN with write access}"

# Thides Gate --part_of--> Thides System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Thides Gate part_of Thides System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=5a12e95e-13f5-49c7-8d25-926870b3f50b + object=2a8f0b00-17b7-4fcd-934a-2a28ec46912c

# Corwin Gate III --part_of--> Corwin System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Corwin Gate III part_of Corwin System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=864ebaec-af4a-4379-932d-7d22e48d1f47 + object=236ad5cb-59dc-41b4-b02c-804132cb9f9a

# Eris Gate IV --part_of--> Eris System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Eris Gate IV part_of Eris System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=c48dab31-ac1b-4fa7-8182-e61537285bd6 + object=caee3173-1f28-4b46-b1fe-e5ece1f68340

# Corwin Gate II --part_of--> Corwin System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Corwin Gate II part_of Corwin System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=895ceb07-3b9f-43dd-8f82-14ddb122ef70 + object=236ad5cb-59dc-41b4-b02c-804132cb9f9a

# Corwin I --part_of--> Corwin System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Corwin I part_of Corwin System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=7fc1f6ac-062f-43af-8e87-643da63b8197 + object=236ad5cb-59dc-41b4-b02c-804132cb9f9a

# Corwin III --part_of--> Corwin System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Corwin III part_of Corwin System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=407dc391-b707-4d25-be34-65c67f1c52e4 + object=236ad5cb-59dc-41b4-b02c-804132cb9f9a

# Corwin IV --part_of--> Corwin System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Corwin IV part_of Corwin System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=8ced5c39-5275-4ea5-9263-210abb90e6b8 + object=236ad5cb-59dc-41b4-b02c-804132cb9f9a

# Corwin B --part_of--> Corwin System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Corwin B part_of Corwin System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=adc991c9-cb1e-4871-baa1-4b0953c53cec + object=236ad5cb-59dc-41b4-b02c-804132cb9f9a

# Corwin V --part_of--> Corwin System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Corwin V part_of Corwin System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=3134baf2-8e2c-4cc1-a43c-0b638159981b + object=236ad5cb-59dc-41b4-b02c-804132cb9f9a

# Corwin A --part_of--> Corwin System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Corwin A part_of Corwin System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=489d3051-7c81-4e55-9dfe-e1328c3289db + object=236ad5cb-59dc-41b4-b02c-804132cb9f9a

# Corwin II --part_of--> Corwin System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Corwin II part_of Corwin System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=99bc4501-c144-4c01-a0f9-1b7627bbb73f + object=236ad5cb-59dc-41b4-b02c-804132cb9f9a

# Corwin III C --part_of--> Corwin III
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Corwin III C part_of Corwin III", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=0edd5295-3e5a-4223-8df3-3750387785b9 + object=407dc391-b707-4d25-be34-65c67f1c52e4

# Corwin III A --part_of--> Corwin III
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Corwin III A part_of Corwin III", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=b4c5e966-89fb-4332-9d49-305a58628a21 + object=407dc391-b707-4d25-be34-65c67f1c52e4

# Corwin III D --part_of--> Corwin III
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Corwin III D part_of Corwin III", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=3551a074-e9a0-41e8-8144-4bd492336f0e + object=407dc391-b707-4d25-be34-65c67f1c52e4

# Eris A --part_of--> Eris System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Eris A part_of Eris System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=594804cb-b14a-4d66-afeb-4252aa8c9d47 + object=caee3173-1f28-4b46-b1fe-e5ece1f68340

# Erisian Belt --part_of--> Eris System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Erisian Belt part_of Eris System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=af8ffac6-bd62-4715-80ca-3d6219c9e9b1 + object=caee3173-1f28-4b46-b1fe-e5ece1f68340

# Eris VI --part_of--> Eris System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Eris VI part_of Eris System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=f379d569-7af4-43fc-ac1e-2429fc0835e4 + object=caee3173-1f28-4b46-b1fe-e5ece1f68340

# Eris I --part_of--> Eris System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Eris I part_of Eris System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=21159da6-0144-4e97-8b16-ada757d9fb61 + object=caee3173-1f28-4b46-b1fe-e5ece1f68340

# Eris IV --part_of--> Eris System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Eris IV part_of Eris System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=e9fa95f1-58c9-4c86-ae73-16ebb816e81d + object=caee3173-1f28-4b46-b1fe-e5ece1f68340

# Eris II --part_of--> Eris System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Eris II part_of Eris System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=f0569461-5ff7-41bc-ab92-714314a43b7d + object=caee3173-1f28-4b46-b1fe-e5ece1f68340

# Eris V --part_of--> Eris System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Eris V part_of Eris System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=6a1282b6-6b54-4523-953d-476c61eb642a + object=caee3173-1f28-4b46-b1fe-e5ece1f68340

# Eris VII --part_of--> Eris System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Eris VII part_of Eris System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=28e0936f-a4f7-4ced-860b-a5c3a52dcd1c + object=caee3173-1f28-4b46-b1fe-e5ece1f68340

# Eris III --part_of--> Eris System
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Eris III part_of Eris System", "altNames": [], "eventType": "Generic", "title": "part_of"}'
#   then Link subject=a9ea6efa-bfa7-4beb-b333-71ee0605aa48 + object=caee3173-1f28-4b46-b1fe-e5ece1f68340

# Sentinel Class Corvette --created--> Steiger Aerospace
curl -sS -X POST "$BASE/world/$W/event" -H "Authorization: Bearer $MOBRPG_TOKEN" -H "Content-Type: application/json" -d '{"name": "Sentinel Class Corvette created Steiger Aerospace", "altNames": [], "eventType": "Generic", "title": "created"}'
#   then Link subject=d02f7f5b-87ff-4f42-ae29-3275adcd9da4 + object=15ef412d-dbf4-47be-a03e-1aeacbcce20e

