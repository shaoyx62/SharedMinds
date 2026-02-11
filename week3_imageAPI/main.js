//credit：https://github.com/dano1234/SharedMindsF25/blob/master/Week%2002%20ML%20APIs/ClientExamples/4.5%20Canvas%202D%20Drag%20Pictures%20JSON%20Objects%20Store/sketch.js
let visualObjectsJSON = [];
let canvas, inputBox;
let currentObject = -1;
let mouseDown = false;

init();

function init() {
    canvas = document.getElementById('myCanvas');
    inputBox = document.getElementById('inputBox');
    clearBtn = document.getElementById('clearBtn');

    resize();
    window.addEventListener('resize', resize);

    visualObjectsJSON = loadJSONFromLocalStorage();

    setupInteractions();
    animate();
}

// Animate loop
function animate() {
    // Perform animation logic here
    let ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    visualObjectsJSON.forEach((obj, i) => {
        if (obj.img) {
            ctx.drawImage(obj.img, obj.x, obj.y, obj.width, obj.height);
        }
        // prompt text shown above the image
        ctx.fillStyle = "grey";
        ctx.font = "12px Arial";
        ctx.fillText(obj.prompt, obj.x, obj.y - 10);
        // highlight the currently dragged object
        if (i === currentObject) {
            ctx.strokeStyle = "#00eeff";
            ctx.lineWidth = 2;
            ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
        }
    });
    requestAnimationFrame(animate);
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function setupInteractions() {
    inputBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && inputBox.value !== '') {
            // generate near the center of the canvas
            const loc = { 
                x: Math.random() * (canvas.width - 256), 
                y: Math.random() * (canvas.height - 256) 
            };
            askPictures(inputBox.value, loc);
            inputBox.value = '';
        }
    });

    // clear canvas
    clearBtn.addEventListener('click', () => {
        visualObjectsJSON = [];
        localStorage.removeItem('v3_data');
        console.log("Canvas cleared");
    });

    // drag image
    document.addEventListener('mousedown', (event) => {
        mouseDown = true;
        currentObject = -1;
        for (let i = 0; i < visualObjectsJSON.length; i++) {
            let thisVisualObject = visualObjectsJSON[i];
            if (isOverJSONObject(thisVisualObject, event.clientX, event.clientY)) {
                currentObject = i;
                break;
            }
        }
        console.log("Clicked on ", currentObject);
    });

    document.addEventListener('mousemove', (event) => {
        //move words around
        if (mouseDown && currentObject > -1) {
            console.log("Mouse moved");
            visualObjectsJSON[currentObject].x = event.clientX - 128;
            visualObjectsJSON[currentObject].y = event.clientY - 128;
        }
    });

    document.addEventListener('mouseup', (event) => {
        if (mouseDown && currentObject > -1) {
            checkMerge(currentObject);
        }
        mouseDown = false;
        saveJSONToLocalStorage();
    });
}

// check if the currently dragged object is close enough to another object to trigger a merge
async function checkMerge(movedIdx) {
    let movedObj = visualObjectsJSON[movedIdx];
    for (let i = 0; i < visualObjectsJSON.length; i++) {
        if (i === movedIdx) continue;
        let other = visualObjectsJSON[i];
        
        if (isColliding(movedObj, other)) {
            // use and to combine the two prompts
            let combinedPrompt = `${movedObj.prompt} and ${other.prompt}`;
            console.log("Merging into:", combinedPrompt);
            
            let loc = { x: (movedObj.x + other.x)/2, y: (movedObj.y + other.y)/2 };

            // remove the two original objects from the array
            let first = Math.max(i, movedIdx);
            let second = Math.min(i, movedIdx);
            visualObjectsJSON.splice(first, 1);
            visualObjectsJSON.splice(second, 1);

            // generate new image for the combined prompt
            await askPictures(combinedPrompt, loc);
            break;
        }
    }
}

async function askPictures(promptWord, location) {

    inputBox.value = "Generating... ";
    document.body.style.cursor = "progress";

    let replicateProxy = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";
    let authToken = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjRiMTFjYjdhYjVmY2JlNDFlOTQ4MDk0ZTlkZjRjNWI1ZWNhMDAwOWUiLCJ0eXAiOiJKV1QifQ.eyJuYW1lIjoiWWl4dWFuIFNoYW8iLCJwaWN0dXJlIjoiaHR0cHM6Ly9saDMuZ29vZ2xldXNlcmNvbnRlbnQuY29tL2EvQUNnOG9jTHR4SEI5U2xfeUJpMzA2LUsyb2lrTVpITERVdlNlWjJWNE1mcExuakNJbkRnWTB3PXM5Ni1jIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL2l0cC1pbWEtcmVwbGljYXRlLXByb3h5IiwiYXVkIjoiaXRwLWltYS1yZXBsaWNhdGUtcHJveHkiLCJhdXRoX3RpbWUiOjE3NzAxNTIzNDMsInVzZXJfaWQiOiJ4b2puMERzNmlzZEk2Z0RWUnNhMmdRV2g0ckwyIiwic3ViIjoieG9qbjBEczZpc2RJNmdEVlJzYTJnUVdoNHJMMiIsImlhdCI6MTc3MDc2NzkzMiwiZXhwIjoxNzcwNzcxNTMyLCJlbWFpbCI6InlzNTY3MUBueXUuZWR1IiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImZpcmViYXNlIjp7ImlkZW50aXRpZXMiOnsiZ29vZ2xlLmNvbSI6WyIxMTY4NTQ3NDQ4NTQwNzU5MTIzNjEiXSwiZW1haWwiOlsieXM1NjcxQG55dS5lZHUiXX0sInNpZ25faW5fcHJvdmlkZXIiOiJnb29nbGUuY29tIn19.GuYxo0Q1qhTkqsgNtuc9e_rN6eWIeYEt3-tb3qId54SnkuJJCfd4KmRvXjiDcV1R_DXzPBhf2pYEAiW0y03hx-zlA7J_CnDZ7T3dTE_ioiGEMscdeBe-CTjGqIHi1_9Rq4PIODXjjCkIjuW24eUC0mFxCLt_E6iEC2VpqnBDN3jGiFgEfGgbE7jderjBzcmRtTcyb9duJsN973GvuQ3saQxEu0xfWYNMkpV36xcTxEzBpWX-C0MH6HSVZK2Sjvma20-gwuTC2VxzOGsLFAYJNsNxCJuXRz-ay--sOFk3GDT6AaufR2w2h0oasTCmQEtRe1FLSHT4uGImtnHN87iu8Q";

    const data = {
        model: "google/imagen-4-fast",
        input: {
            prompt: promptWord
        }
    };

    const options = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "Authorization": `Bearer ${authToken}`
        },
        body: JSON.stringify(data)
    };

    const response = await fetch(replicateProxy, options);
    const json = await response.json();

    let img = new Image();
    img.crossOrigin = "anonymous";
    img.src = json.output;

    img.onload = () => {

        let newObject = {
            prompt: promptWord,
            imageURL: json.output,
            imageModel: data.model,
            x: location.x,
            y: location.y,
            width: 256,
            height: 256,
            img: img
        };

        visualObjectsJSON.push(newObject);
        saveJSONToLocalStorage();
    };

    document.body.style.cursor = "auto";
    inputBox.value = "";
}

function isOverJSONObject(jsonObject, x, y) {
    return (x > jsonObject.x && x < jsonObject.x + jsonObject.width && y > jsonObject.y && y < jsonObject.y + jsonObject.height);
}

function isColliding(a, b) {
    // use distance between centers to determine collision, allowing for some overlap
    let centerA = { x: a.x + 128, y: a.y + 128 };
    let centerB = { x: b.x + 128, y: b.y + 128 };
    let dist = Math.sqrt(Math.pow(centerA.x - centerB.x, 2) + Math.pow(centerA.y - centerB.y, 2));
    return dist < 150; // distance threshold for merging
}

function saveJSONToLocalStorage() {
    localStorage.setItem('visualObjectsJSON', JSON.stringify(visualObjectsJSON));
    console.log("JSON saved to localStorage");
}

function loadJSONFromLocalStorage() {

    let loadedJSON = JSON.parse(localStorage.getItem('visualObjectsJSON'));
    if (!loadedJSON) {
        console.log("No JSON found in localStorage");
        return [];
    }
    for (let i = 0; i < loadedJSON.length; i++) {
        let thisVisualObject = loadedJSON[i];
        let img = document.createElement("img");
        img.style.position = 'absolute';
        img.style.left = loadedJSON[i].x + 'px';
        img.style.top = loadedJSON[i].y + 'px';
        img.style.width = '256px';
        img.style.height = '256px';
        img.src = loadedJSON[i].imageURL;
        loadedJSON[i].img = img;
    }
    return loadedJSON;
}