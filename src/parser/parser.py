import easyocr
import os
import json

reader = easyocr.Reader(['en'])
result = reader.readtext('assets/characterCardImages/mystique_injured.jpg', detail=0)

print(json.dumps(result))

# with open('parsed.json', 'w') as outfile:
#     for file in os.listdir('assets/characterCardImages'):
#         result = reader.readtext('assets/characterCardImages/' + file, detail=0)
#         json = json.load(result)
#         json.dump(json, outfile)
